/**
 * 一次性集成验证：开机补偿扫描。
 *   先造一条 aiProcessed=false 的记录（模拟上次进程崩溃遗留）
 *   → queue.recover()（扫出待加工记录并重新入队）
 *   → drain → 读回确认该记录已加工回写（aiProcessed=true）。
 *
 * 运行：npx tsx scripts/verify-recover.ts（需本地 Strapi 在跑）
 */
import { loadConfig } from '../src/config.js';
import { StrapiClient } from '../src/strapi-client.js';
import { LlmProcessor } from '../src/llm-processor.js';
import { EnrichmentQueue } from '../src/enrichment-queue.js';

const SAMPLE = '我梦见一列夜行火车穿过森林，窗外的树都挂满了灯笼，列车员是一只戴帽子的猫。';

async function main() {
  const cfg = loadConfig();
  const strapi = new StrapiClient({ baseUrl: cfg.strapiUrl, token: cfg.strapiToken });
  const llm = new LlmProcessor(cfg.llm);
  const queue = new EnrichmentQueue(strapi, llm);

  // 1. 造一条未加工记录
  console.log('① 造一条 aiProcessed=false 的遗留记录……');
  const created = await strapi.createDream({
    rawContent: SAMPLE,
    dreamedAt: new Date().toISOString(),
    source: 'verify-recover',
    aiProcessed: false,
  });
  console.log(`   id=${created.id} documentId=${created.documentId}`);

  // 2. 补偿扫描
  console.log('② 执行补偿扫描 recover()……');
  const n = await queue.recover();
  console.log(`   扫出并入队 ${n} 条`);
  await queue.drain();
  console.log('   队列已排空');

  // 3. 读回确认目标记录已加工
  const res = await fetch(`${cfg.strapiUrl}/api/dreams/${created.documentId}`, {
    headers: { Authorization: `Bearer ${cfg.strapiToken}` },
  });
  const json = (await res.json()) as { data?: Record<string, any> };
  const d = json.data;

  console.log('');
  console.log('   目标记录 aiProcessed :', d?.aiProcessed);
  console.log('   目标记录 标题        :', d?.title);
  console.log('');

  if (n >= 1 && d?.aiProcessed === true && d?.title) {
    console.log('✅ 补偿扫描验证通过：遗留的未加工记录被扫出并成功补做加工。');
    process.exit(0);
  } else {
    console.log('⚠️ 未达到预期（可能 LLM 瞬时失败）。原文仍完好。');
    process.exit(3);
  }
}

main().catch((err) => {
  console.error('脚本异常：', err);
  process.exit(1);
});
