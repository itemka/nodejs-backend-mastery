import type {
  LlmAnthropicTextEditorToolDefinition,
  LlmToolResultBlock,
  LlmToolUseBlock,
} from '@workspaces/packages/llm-client';

export const TEXT_EDITOR_TOOL_NAME = 'str_replace_based_edit_tool' as const;
export const TEXT_EDITOR_TOOL_TYPE = 'text_editor_20250728' as const;

export type TextEditorCommand = 'view' | 'create' | 'str_replace' | 'insert';

export type TextEditorToolInput =
  | {
      readonly command: 'view';
      readonly path: string;
      readonly view_range?: readonly [number, number];
    }
  | {
      readonly command: 'create';
      readonly file_text: string;
      readonly path: string;
    }
  | {
      readonly command: 'str_replace';
      readonly new_str: string;
      readonly old_str: string;
      readonly path: string;
    }
  | {
      readonly command: 'insert';
      readonly insert_line: number;
      readonly insert_text: string;
      readonly path: string;
    };

export interface TextEditorRuntimeConfig {
  readonly allowHiddenPaths?: boolean;
  readonly backupRoot?: string;
  readonly maxEditableBytes?: number;
  readonly maxViewBytes?: number;
  readonly maxViewCharacters?: number;
  readonly toolDefinition?: LlmAnthropicTextEditorToolDefinition;
  readonly workspaceRoot: string;
}

export interface TextEditorRuntime {
  readonly definition: LlmAnthropicTextEditorToolDefinition;
  readonly toolName: typeof TEXT_EDITOR_TOOL_NAME;
  execute(toolUse: LlmToolUseBlock): Promise<LlmToolResultBlock>;
}

export function createTextEditorToolDefinition(
  maxCharacters?: number,
): LlmAnthropicTextEditorToolDefinition {
  return {
    kind: 'anthropic_builtin',
    name: TEXT_EDITOR_TOOL_NAME,
    provider: 'anthropic',
    type: TEXT_EDITOR_TOOL_TYPE,
    ...(maxCharacters === undefined ? {} : { maxCharacters }),
  };
}
