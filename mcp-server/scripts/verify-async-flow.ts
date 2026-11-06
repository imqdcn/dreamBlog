/**
 * 一次性集成验证：走完整异步加工链路（真实 Strapi + 真实 LLM 代理）。
 *   createDream（存原文，aiProcessed=false）
 *   → EnrichmentQueue.enqueue → drain（后台加工 + PUT 回写）
 *   → 读回确认 aiProcessed=true 且字段已补全。
 *
 * 运行：npx tsx scripts/verify-async-flow.ts
 * 需要本地 Strapi 在跑，.env 的 STRAPI_URL/STRAPI_TOKEN/LLM_* 已配置。
 */
import { loadConfig } from '../src/config.js';
import { StrapiClient } from '../src/strapi-client.js';
import { LlmProcessor } from '../src/llm-processor.js';
import { EnrichmentQueue } from '../src/enrichment-queue.js';

const SAMPLE = `我梦见自己在一座漂浮在云端的图书馆里，书架一直延伸到看不见的高处，
我踮脚去够一本会发光的书，结果整个人飘了起来，书页翻动时落下银色的星尘。`;

async function main() {
  const cfg = loadConfig();
  const strapi = new StrapiClient({ baseUrl: cfg.strapiUrl, token: cfg.strapiToken });
  const llm = new LlmProcessor(cfg.llm);
  const queue = new EnrichmentQueue(strapi, llm);

  console.log('Strapi:', cfg.strapiUrl);
  console.log('LLM   :', cfg.llm.enabled ? `${cfg.llm.model}` : '未启用');
  console.log('');

  // 1. 存原文
  console.log('① 写入原文（aiProcessed=false）……');
  const created = await strapi.createDream({
    rawContent: SAMPLE,
    dreamedAt: new Date().toISOString(),
    source: 'verify-script',
    aiProcessed: false,
  });
  console.log(`   已创建：id=${created.id} documentId=${created.documentId}`);
  if (!created.documentId) {
    console.log('❌ 未获得 documentId，无法回写。');
    process.exit(2);
  }

  // 2. 入队并等待后台加工完成
  console.log('② 入队后台加工并等待排空……');
  const t0 = Date.now();
  queue.enqueue({ documentId: created.documentId, rawContent: SAMPLE });
  await queue.drain();
  console.log(`   队列已排空（耗时 ${Date.now() - t0}ms）`);

  // 3. 读回确认
  console.log('③ 读回记录确认回写结果……');
  const res = await fetch(`${cfg.strapiUrl}/api/dreams/${created.documentId}`, {
    headers: { Authorization: `Bearer ${cfg.strapiToken}` },
  });
  const json = (await res.json()) as { data?: Record<string, any> };
  const d = json.data;
  if (!d) {
    console.log('❌ 读回失败。');
    process.exit(2);
  }

  console.log('');
  console.log('   aiProcessed :', d.aiProcessed);
  console.log('   标题        :', d.title);
  console.log('   摘要        :', d.summary);
  console.log('   关键词      :', Array.isArray(d.keywords) ? d.keywords.join('、') : d.keywords);
  console.log('   情绪        :', d.emotion, `(${d.emotionScore})`);
  console.log('   清晰度      :', d.clarity);
  console.log('');

  if (d.aiProcessed === true && d.title) {
    console.log('✅ 异步加工链路验证通过：原文先落库，后台加工已回写。');
    process.exit(0);
  } else {
    console.log('⚠️ 记录已保存但未成功加工（可能 LLM 瞬时失败并耗尽重试），原文完好。');
    process.exit(3);
  }
}

main().catch((err) => {
  console.error('脚本异常：', err);
  process.exit(1);
});
