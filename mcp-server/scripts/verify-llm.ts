/**
 * 一次性验证脚本：用 .env 中的 LLM 配置，对一段示例梦境做真实加工。
 * 复用生产逻辑 LlmProcessor，不连接小智、不写数据库。
 *
 * 运行：npx tsx scripts/verify-llm.ts
 */
import { loadConfig } from '../src/config.js';
import { LlmProcessor } from '../src/llm-processor.js';

const SAMPLE = `我梦见自己走在一条很长的隧道里，墙壁会发光，是淡蓝色的。
走到尽头的时候突然掉进了海里，但我能在水里呼吸，还看到一群发光的水母从我身边飘过。`;

async function main() {
  const cfg = loadConfig();
  console.log('LLM 配置：');
  console.log('  baseUrl =', cfg.llm.baseUrl);
  console.log('  model   =', cfg.llm.model);
  console.log('  enabled =', cfg.llm.enabled);
  console.log('');

  if (!cfg.llm.enabled) {
    console.log('LLM 未启用（缺少 LLM_API_KEY 或 LLM_ENABLED=false），无法验证。');
    process.exit(1);
  }

  const processor = new LlmProcessor(cfg.llm);
  console.log('正在调用代理做梦境加工……\n');
  const t0 = Date.now();
  const result = await processor.enrich(SAMPLE);
  const ms = Date.now() - t0;

  if (!result) {
    console.log(`❌ 加工失败（耗时 ${ms}ms）。`);
    console.log('上方日志会显示失败原因（HTTP 状态 / 网络 / JSON 解析）。');
    console.log('record_dream 在真实运行时会降级为仅保存原文，不会丢记录。');
    process.exit(2);
  }

  console.log(`✅ 加工成功（耗时 ${ms}ms），解析后的结构化结果：\n`);
  console.log('  标题    :', result.title);
  console.log('  摘要    :', result.summary);
  console.log('  关键词  :', result.keywords.join('、'));
  console.log('  情绪    :', result.emotion);
  console.log('  情绪分  :', result.emotionScore);
  console.log('  清晰度  :', result.clarity ?? '(未提供)');
  process.exit(0);
}

main().catch((err) => {
  console.error('脚本异常：', err);
  process.exit(1);
});
