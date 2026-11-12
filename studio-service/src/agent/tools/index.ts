/** 装配五个只读工具，供 createToolRegistry 使用（设计 7.5）。 */

import { DEFAULT_TIMEZONE } from '../prompt.js';
import type { AgentTool } from './common.js';
import { emotionTrendTool } from './emotion-trend.js';
import { createFindSimilarDreamsTool } from './find-similar-dreams.js';
import { getDreamTool } from './get-dream.js';
import { keywordStatsTool } from './keyword-stats.js';
import { createSearchDreamsTool } from './search-dreams.js';

export function createDreamTools(tz: string = DEFAULT_TIMEZONE): AgentTool[] {
  return [
    createSearchDreamsTool(tz),
    getDreamTool,
    emotionTrendTool,
    keywordStatsTool,
    createFindSimilarDreamsTool(),
  ];
}

export { createFindSimilarDreamsTool, findSimilarDreamsTool } from './find-similar-dreams.js';
