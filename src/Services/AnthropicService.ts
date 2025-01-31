import { Editor, MarkdownView, Notice, requestUrl } from "obsidian";
import { StreamManager } from "src/stream";
import { Message } from "src/Models/Message";
import { AI_SERVICE_ANTHROPIC, ROLE_USER } from "src/Constants";
import { ChatGPT_MDSettings } from "src/Models/Config";
import { EditorService } from "src/Services/EditorService";
import { IAiApiService } from "src/Services/AiService";

export interface AnthropicStreamPayload {
  model: string;
  messages: Array<Message>;
  max_completion_tokens: number;
  stream: boolean;
}

export interface AnthropicConfig {
  aiService: string;
  max_tokens: number;
  model: string;
  stream: boolean;
  system_commands: string[] | null;
  url: string;
}

export const DEFAULT_ANTHROPIC_CONFIG: AnthropicConfig = {
  aiService: AI_SERVICE_ANTHROPIC,
  max_tokens: 300,
  model: "claude-3-5-haiku-latest",
  stream: true,
  system_commands: null,
  url: "https://api.anthropic.com/v1/messages",
};

export class AnthropicService implements IAiApiService {
  constructor(private streamManager: StreamManager) {}

  async callAIAPI(
    messages: Message[],
    options: Partial<AnthropicConfig> = {},
    headingPrefix: string,
    editor?: Editor,
    setAtCursor?: boolean,
    apiKey?: string
  ): Promise<any> {
    const config: AnthropicConfig = { ...DEFAULT_ANTHROPIC_CONFIG, ...options };
    return options.stream && editor
      ? this.callStreamingAPI(apiKey, messages, config, editor, headingPrefix, setAtCursor)
      : this.callNonStreamingAPI(apiKey, messages, config);
  }

  async inferTitle(
    view: MarkdownView,
    settings: ChatGPT_MDSettings,
    messages: string[],
    editorService: EditorService
  ): Promise<any> {
    if (!view.file) {
      throw new Error("No active file found");
    }

    console.log("[ChatGPT MD] auto inferring title from messages");

    const inferredTitle = await this.inferTitleFromMessages(settings.apiKey, messages, settings);
    if (inferredTitle) {
      console.log(`[ChatGPT MD] automatically inferred title: ${inferredTitle}. Changing file name...`);
      await editorService.writeInferredTitle(view, settings.chatFolder, inferredTitle);
    } else {
      new Notice("[ChatGPT MD] Could not infer title", 5000);
    }
  }

  private handleAPIError(err: any, config: AnthropicConfig, prefix: string) {
    if (err instanceof Object) {
      if (err.error) {
        new Notice(`${prefix} :: ${err.error.message}`);
        throw new Error(JSON.stringify(err.error));
      }
      if (config.url !== DEFAULT_ANTHROPIC_CONFIG.url) {
        new Notice(`${prefix} calling specified url: ${config.url}`);
        throw new Error(`${prefix} calling specified url: ${config.url}`);
      }
      new Notice(`${prefix} :: ${JSON.stringify(err)}`);
      throw new Error(JSON.stringify(err));
    }
    new Notice(`${prefix} calling ${config.model}, see console for details`);
    throw new Error(`${prefix} see error: ${err}`);
  }

  private createPayload(config: AnthropicConfig, messages: Message[]): AnthropicStreamPayload {
    return {
      model: config.model,
      messages,
      max_completion_tokens: config.max_tokens,
      stream: config.stream,
    };
  }

  private async callStreamingAPI(
    apiKey: string | undefined,
    messages: Message[],
    config: AnthropicConfig,
    editor: Editor,
    headingPrefix: string,
    setAtCursor?: boolean | undefined
  ): Promise<any> {
    try {
      const payload = this.createPayload(config, messages);
      const response = await this.streamManager.stream(
        editor,
        config.url,
        payload,
        {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        config.aiService,
        setAtCursor,
        headingPrefix
      );
      return { fullstr: response, mode: "streaming" };
    } catch (err) {
      this.handleAPIError(err, config, "[ChatGPT MD] Stream = True Error");
    }
  }

  private async callNonStreamingAPI(
    apiKey: string | undefined,
    messages: Message[],
    config: AnthropicConfig
  ): Promise<any> {
    try {
      console.log(`[ChatGPT MD] "no stream"`, config);

      config.stream = false;

      const payload = this.createPayload(config, messages);
      const responseUrl = await requestUrl({
        url: config.url,
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        contentType: "application/json",
        body: JSON.stringify(payload),
        throw: false,
      });
      const data = responseUrl.json;
      if (data?.error) {
        new Notice(`[ChatGPT MD] Stream = False Error :: ${data.error.message}`);
        throw new Error(JSON.stringify(data.error));
      }
      return data.choices[0].message.content;
    } catch (err) {
      this.handleAPIError(err, config, "[ChatGPT MD] Error");
    }
  }

  private inferTitleFromMessages = async (apiKey: string, messages: string[], settings: any) => {
    try {
      if (messages.length < 2) {
        new Notice("Not enough messages to infer title. Minimum 2 messages.");
        return "";
      }
      const prompt = `Infer title from the summary of the content of these messages. The title **cannot** contain any of the following characters: colon, back slash or forward slash. Just return the title. Write the title in ${settings.inferTitleLanguage}. \nMessages:\n\n${JSON.stringify(
        messages
      )}`;

      const config = { ...DEFAULT_ANTHROPIC_CONFIG, ...settings };

      return await this.callNonStreamingAPI(settings.apiKey, [{ role: ROLE_USER, content: prompt }], config);
    } catch (err) {
      new Notice("[ChatGPT MD] Error inferring title from messages");
      throw new Error("[ChatGPT MD] Error inferring title from messages" + err);
    }
  };
}
