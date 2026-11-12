/** 灵感选择：纯 reducer（需求 7.1–7.5） */

export type SelectionId = number | string;

export const MAX_SELECTION = 5;

export interface SelectionState {
  /** 已选 id，按选择顺序，无重复 */
  readonly selected: readonly SelectionId[];
}

export type SelectionAction =
  | { type: 'select'; id: SelectionId }
  | { type: 'deselect'; id: SelectionId }
  | { type: 'clear' };

export const initialSelection: SelectionState = { selected: [] };

export function selectionReducer(
  state: SelectionState,
  action: SelectionAction
): SelectionState {
  switch (action.type) {
    case 'select':
      // 已选中或已满：状态不变
      if (state.selected.includes(action.id) || state.selected.length >= MAX_SELECTION) {
        return state;
      }
      return { selected: [...state.selected, action.id] };
    case 'deselect':
      if (!state.selected.includes(action.id)) return state;
      return { selected: state.selected.filter((x) => x !== action.id) };
    case 'clear':
      return state.selected.length === 0 ? state : { selected: [] };
    default:
      return state;
  }
}

export const select = (state: SelectionState, id: SelectionId) =>
  selectionReducer(state, { type: 'select', id });
export const deselect = (state: SelectionState, id: SelectionId) =>
  selectionReducer(state, { type: 'deselect', id });
export const clear = (state: SelectionState) => selectionReducer(state, { type: 'clear' });

/** 至少选 1 条且已选择风格才可提交 */
export function canSubmit(state: SelectionState, style: string | null | undefined): boolean {
  return state.selected.length >= 1 && typeof style === 'string' && style.length > 0;
}

/**
 * 条目是否可勾选：已选中的恒可操作（取消勾选）；
 * 未选中的仅在未满 5 条时可勾选。
 */
export function isCheckable(state: SelectionState, id: SelectionId): boolean {
  return state.selected.includes(id) || state.selected.length < MAX_SELECTION;
}

/** 复选框 disabled：未选中且已满时为真 */
export function isCheckboxDisabled(state: SelectionState, id: SelectionId): boolean {
  return !isCheckable(state, id);
}
