declare module "openclaw/plugin-sdk/plugin-entry" {
  export interface ToolContent {
    type: "text";
    text: string;
  }

  export interface ToolResult {
    content: ToolContent[];
  }

  export interface PluginTool {
    name: string;
    description: string;
    parameters: import("@sinclair/typebox").TObject;
    execute: (id: string, params: Record<string, unknown>) => Promise<ToolResult>;
  }

  export interface ServiceContext {
    config: Record<string, unknown>;
  }

  export interface PluginService {
    id: string;
    start: (ctx: ServiceContext) => Promise<void>;
    stop: () => Promise<void>;
  }

  export interface CliCommand {
    description: (desc: string) => CliCommand;
    option: (flags: string, desc?: string, defaultValue?: string) => CliCommand;
    action: (fn: (...args: unknown[]) => Promise<void>) => CliCommand;
    command: (name: string) => CliCommand;
  }

  export interface CliProgram {
    command: (name: string) => CliCommand;
  }

  export interface CliContext {
    program: CliProgram;
  }

  export interface PluginApi {
    registerTool: (tool: PluginTool) => void;
    registerService: (service: PluginService) => void;
    registerCli: (setup: (ctx: CliContext) => Promise<void>) => void;
    config: Record<string, unknown>;
  }

  export function definePluginEntry(setup: (api: PluginApi) => void): void;
}
