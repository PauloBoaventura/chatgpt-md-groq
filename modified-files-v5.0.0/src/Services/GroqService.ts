import { Editor } from "obsidian";
import { Message } from "src/Models/Message";
import { AI_SERVICE_GROQ, PLUGIN_SYSTEM_MESSAGE, ROLE_DEVELOPER } from "src/Constants";
import { BaseAiService, IAiApiService, GroqModel } from "./AiService";
import { ChatGPT_MDSettings } from "src/Models/Config";
import { ApiService } from "./ApiService";
import { ApiAuthService, isValidApiKey } from "./ApiAuthService";
import { ApiResponseParser } from "./ApiResponseParser";
import { ErrorService } from "./ErrorService";
import { NotificationService } from "./NotificationService";
import { LogHelperDetailed } from "../Utilities/LogHelperDetailed";
import { Plugin } from "obsidian";

export const DEFAULT_GROQ_CONFIG: GroqConfig = {
  aiService: AI_SERVICE_GROQ,
  frequency_penalty: 0,
  max_tokens: 200,
  model: "mixtral-8x7b-32768",
  presence_penalty: 0,
  stream: true,
  system_commands: null,
  tags: [],
  temperature: 0.5,
  title: "Untitled",
  top_p: 1,
  url: "https://api.groq.com",
};

export const fetchAvailableGroqModels = async (url: string, apiKey: string) => {
  try {
    const apiAuthService = new ApiAuthService();

    if (!isValidApiKey(apiKey)) {
      console.error("Groq API key is missing. Please add your Groq API key in the settings.");
      return [];
    }

    // Use ApiService for the API request
    const apiService = new ApiService();
    const headers = apiAuthService.createAuthHeaders(apiKey, AI_SERVICE_GROQ);

    // Use the correct endpoint for Groq models
    const models = await apiService.makeGetRequest(`${url}/openai/v1/models`, headers, AI_SERVICE_GROQ);

    return models.data
      .filter(
        (model: GroqModel) =>
          (model.id.includes("llama3") ||
            model.id.includes("mixtral") ||
            model.id.includes("gemma") ||
            model.id.includes("llama2")) &&
          !model.id.includes("embedding")
      )
      .sort((a: GroqModel, b: GroqModel) => {
        if (a.id < b.id) return 1;
        if (a.id > b.id) return -1;
        return 0;
      })
      .map((model: GroqModel) => model.id);
  } catch (error) {
    console.error("Error fetching Groq models:", error);
    return [];
  }
};

export class GroqService extends BaseAiService implements IAiApiService {
  protected errorService: ErrorService;
  protected notificationService: NotificationService;
  protected apiService: ApiService;
  protected apiAuthService: ApiAuthService;
  protected apiResponseParser: ApiResponseParser;
  protected serviceType = AI_SERVICE_GROQ;

  constructor(
    errorService?: ErrorService,
    notificationService?: NotificationService,
    apiService?: ApiService,
    apiAuthService?: ApiAuthService,
    apiResponseParser?: ApiResponseParser
  ) {
    super(errorService, notificationService);
    this.errorService = errorService || new ErrorService(this.notificationService);
    this.apiService = apiService || new ApiService(this.errorService, this.notificationService);
    this.apiAuthService = apiAuthService || new ApiAuthService(this.notificationService);
    this.apiResponseParser = apiResponseParser || new ApiResponseParser(this.notificationService);
  }

  getDefaultConfig(): GroqConfig {
    return DEFAULT_GROQ_CONFIG;
  }

  getApiKeyFromSettings(settings: ChatGPT_MDSettings): string {
    // Tentar múltiplas formas de obter a API key
    const apiKey = settings.groqApiKey || 
                   (settings as any).groq?.apiKey || 
                   this.apiAuthService.getApiKey(settings, AI_SERVICE_GROQ);
    
    console.log("[GroqService] API Key obtida:", apiKey ? apiKey.substring(0, 10) + "..." : "NENHUMA");
    return apiKey || "";
  }

  createPayload(config: GroqConfig, messages: Message[]): GroqStreamPayload {
    // Remove the provider prefix if it exists in the model name
    const modelName = config.model.includes("@") ? config.model.split("@")[1] : config.model;
    
    // Validar se o modelo é suportado pela Groq
    const supportedModels = [
      "mixtral-8x7b-32768",
      "llama3-70b-8192", 
      "llama3-8b-8192",
      "gemma-7b-it",
      "llama2-70b-4096"
    ];
    
    if (!supportedModels.some(model => modelName.includes(model.split('-')[0]))) {
      console.warn("[GroqService] Modelo pode não ser suportado:", modelName);
    }

    console.log("[GroqService] Modelo selecionado:", modelName);

    // Process system commands if they exist
    let processedMessages = messages;
    if (config.system_commands && config.system_commands.length > 0) {
      // Add system commands to the beginning of the messages
      const systemMessages = config.system_commands.map((command) => ({
        role: ROLE_DEVELOPER,
        content: command,
      }));

      processedMessages = [...systemMessages, ...messages];
      console.log(`[ChatGPT MD] Added ${systemMessages.length} developer commands to messages`);
    }

    // Create base payload
    const payload: GroqStreamPayload = {
      model: modelName,
      messages: processedMessages,
      max_tokens: config.max_tokens,
      stream: config.stream,
    };

    // Only include these parameters if the model name doesn't contain "search"
    if (!modelName.includes("search")) {
      payload.temperature = config.temperature;
      payload.top_p = config.top_p;
      payload.presence_penalty = config.presence_penalty;
      payload.frequency_penalty = config.frequency_penalty;
    }

    return payload;
  }

  handleAPIError(err: any, config: GroqConfig, prefix: string): never {
    // Use the new ErrorService to handle errors
    const context = {
      model: config.model,
      url: config.url,
      defaultUrl: DEFAULT_GROQ_CONFIG.url,
      aiService: AI_SERVICE_GROQ,
    };

    // Special handling for custom URL errors
    if (err instanceof Object && config.url !== DEFAULT_GROQ_CONFIG.url) {
      return this.errorService.handleUrlError(config.url, DEFAULT_GROQ_CONFIG.url, AI_SERVICE_GROQ) as never;
    }

    // Use the centralized error handling
    return this.errorService.handleApiError(err, AI_SERVICE_GROQ, {
      context,
      showNotification: true,
      logToConsole: true,
    }) as never;
  }

  protected async callStreamingAPI(
    apiKey: string | undefined,
    messages: Message[],
    config: GroqConfig,
    editor: Editor,
    headingPrefix: string,
    setAtCursor?: boolean | undefined
  ): Promise<{ fullString: string; mode: "streaming"; wasAborted?: boolean }> {
    try {
      // Use the common preparation method
      const { payload, headers } = this.prepareApiCall(apiKey, messages, config);

      // Insert assistant header
      const cursorPositions = this.apiResponseParser.insertAssistantHeader(editor, headingPrefix, payload.model);

      // Make streaming request using ApiService with centralized endpoint
      const response = await this.apiService.makeStreamingRequest(
        this.getApiEndpoint(config),
        payload,
        headers,
        this.serviceType
      );

      // Process the streaming response using ApiResponseParser
      const result = await this.apiResponseParser.processStreamResponse(
        response,
        this.serviceType,
        editor,
        cursorPositions,
        setAtCursor,
        this.apiService
      );

      // Use the helper method to process the result
      return this.processStreamingResult(result);
    } catch (err) {
      // The error is already handled by the ApiService, which uses ErrorService
      // Just return the error message for the chat
      const errorMessage = `Error: ${err}`;
      return { fullString: errorMessage, mode: "streaming" };
    }
  }

  protected async callNonStreamingAPI(
    apiKey: string | undefined,
    messages: Message[],
    config: GroqConfig
  ): Promise<any> {
    try {
      // Use the common preparation method
      const { payload, headers } = this.prepareApiCall(apiKey, messages, config);

      // Make non-streaming request using ApiService
      const response = await this.apiService.makeNonStreamingRequest(
        this.getApiEndpoint(config),
        payload,
        headers,
        this.serviceType
      );

      // Process the response using ApiResponseParser
      return this.apiResponseParser.parseNonStreamingResponse(response, this.serviceType);
    } catch (err) {
      return this.handleApiCallError(err, config);
    }
  }

  protected showNoTitleInferredNotification(): void {
    this.notificationService?.showWarning("Could not infer title. The file name was not changed.");
  }

  protected addPluginSystemMessage(messages: Message[]): Message[] {
    // Add the plugin system message if it's not already present
    const hasSystemMessage = messages.some((msg) => msg.role === "system");
    if (!hasSystemMessage) {
      return [
        {
          role: "system",
          content: PLUGIN_SYSTEM_MESSAGE,
        },
        ...messages,
      ];
    }
    return messages;
  }

  /**
   * Test method to verify Groq configuration
   */
  async testConfiguration(settings: ChatGPT_MDSettings): Promise<{ success: boolean; message: string }> {
    try {
      console.log("[GroqService] Iniciando teste de configuração...");
      console.log("[GroqService] Configurações disponíveis:", {
        groqApiKey: !!settings.groqApiKey,
        groqUrl: settings.groqUrl,
        groqConfig: !!(settings as any).groq
      });
      
      const apiKey = this.getApiKeyFromSettings(settings);
      
      if (!apiKey || apiKey.trim() === "") {
        return { 
          success: false, 
          message: "❌ API Key da Groq não está configurada no plugin.\nVerifique se foi adicionada na seção 'API Keys' das configurações." 
        };
      }

      // Validar formato da API Key
      if (!apiKey.startsWith("gsk_")) {
        return { 
          success: false, 
          message: `❌ API Key da Groq parece estar em formato incorreto.\nEsperado: gsk_...\nEncontrado: ${apiKey.substring(0, 10)}...` 
        };
      }

      // Usar URL das configurações ou padrão
      const baseUrl = settings.groqUrl || DEFAULT_GROQ_CONFIG.url;
      const endpoint = `${baseUrl}/openai/v1/models`;
      
      console.log("[GroqService] Testing connection to:", endpoint);
      console.log("[GroqService] API Key format:", apiKey.substring(0, 10) + "...");

      // Fazer uma requisição simples para testar conectividade
      const headers = {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "User-Agent": "ChatGPT-MD-Plugin/1.0"
      };

      const response = await fetch(endpoint, {
        method: "GET",
        headers: headers,
        signal: AbortSignal.timeout(10000) // 10 segundos timeout
      });

      console.log("[GroqService] Response status:", response.status);
      console.log("[GroqService] Response headers:", Object.fromEntries(response.headers.entries()));

      if (!response.ok) {
        const errorText = await response.text();
        console.error("[GroqService] Error response:", errorText);
        
        if (response.status === 401) {
          return { success: false, message: "❌ API Key da Groq é inválida. Verifique se está correta." };
        } else if (response.status === 403) {
          return { success: false, message: "❌ Acesso negado. Verifique se a API Key tem as permissões necessárias." };
        } else if (response.status >= 500) {
          return { success: false, message: "❌ Servidor da Groq indisponível no momento. Tente novamente mais tarde." };
        } else {
          return { success: false, message: `❌ Erro HTTP ${response.status}: ${errorText}` };
        }
      }

      const data = await response.json();
      console.log("[GroqService] Available models:", data.data?.length || 0);

      return { 
        success: true, 
        message: `✅ Conexão com Groq estabelecida com sucesso!\n📊 ${data.data?.length || 0} modelos disponíveis\n🔗 Endpoint: ${endpoint}` 
      };

    } catch (error: any) {
      console.error("[GroqService] Connection test failed:", error);
      
      if (error.name === "TimeoutError" || error.name === "AbortError") {
        return { 
          success: false, 
          message: "❌ Timeout na conexão com a Groq. Verifique sua conexão com a internet." 
        };
      } else if (error.message.includes("fetch")) {
        return { 
          success: false, 
          message: "❌ Erro de rede ao conectar com a Groq. Verifique sua conexão com a internet." 
        };
      } else {
        return { 
          success: false, 
          message: `❌ Erro na configuração da Groq: ${error.message || error}` 
        };
      }
    }
  }

  /**
   * Chamada Groq com logs, fallback e tratamento de erro aprimorado
   */
  async chatWithFallback(
    prompt: string,
    settings: ChatGPT_MDSettings,
    plugin: Plugin,
    model?: string,
    fallbackModel: string = "mixtral-8x7b-32768"
  ): Promise<string> {
    const apiKey = this.getApiKeyFromSettings(settings);
    
    console.log("[GroqService] Configurações recebidas:", {
      hasApiKey: !!apiKey,
      apiKeyFormat: apiKey ? apiKey.substring(0, 10) + "..." : "NENHUMA",
      model: model || "padrão",
      settingsGroqApiKey: !!settings.groqApiKey,
      settingsGroqUrl: settings.groqUrl || "não definida"
    });
    
    if (!apiKey || apiKey.trim() === "") {
      console.error("[GroqService] API Key não encontrada nas configurações:", {
        groqApiKey: settings.groqApiKey,
        groqConfig: (settings as any).groq
      });
      throw new Error("❌ API Key Groq ausente. Configure nas configurações do plugin.");
    }

    if (!apiKey.startsWith("gsk_")) {
      console.error("[GroqService] Formato da API Key inválido:", apiKey.substring(0, 15));
      throw new Error("❌ API Key Groq inválida. Deve começar com 'gsk_'.");
    }

    // Obter endpoint das configurações ou usar padrão
    const baseUrl = settings.groqUrl || DEFAULT_GROQ_CONFIG.url;
    const endpoint = `${baseUrl}/openai/v1/chat/completions`;
    
    // Obter modelo das configurações ou usar padrão
    const modelToUse = model || 
                       settings.groq?.model || 
                       (settings as any).groqModel || 
                       DEFAULT_GROQ_CONFIG.model;
    
    console.log("[GroqService] Configuração da chamada:", {
      endpoint,
      modelToUse,
      baseUrl
    });
    const max_tokens = 512;
    const temperature = 0.7;
    const stream = false;

    const payload = {
      model: modelToUse,
      messages: [
        { role: "system", content: "Você é uma IA Groq no Obsidian." },
        { role: "user", content: prompt }
      ],
      temperature,
      max_tokens,
      stream
    };

    const headers = {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "User-Agent": "ChatGPT-MD-Plugin/1.0"
    };

    console.log("🔎 [Groq] Endpoint:", endpoint);
    console.log("🔎 [Groq] Headers:", { ...headers, Authorization: "Bearer ***" });
    console.log("🔎 [Groq] Payload:", payload);

    const start = Date.now();
    
    try {
      console.log("🚀 [Groq] Iniciando requisição...");
      
      const response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30000) // 30 segundos timeout
      });

      const text = await response.text();
      const duration = Date.now() - start;
      
      console.log("⏱️ [Groq] Latência:", duration, "ms");
      console.log("🔎 [Groq] Status HTTP:", response.status);
      console.log("🔎 [Groq] Response Headers:", Object.fromEntries(response.headers.entries()));
      
      if (!response.ok) {
        console.error("🔎 [Groq] Error Response Body:", text);
        
        let errorMessage = `Groq API ERROR ${response.status}`;
        try {
          const errorData = JSON.parse(text);
          errorMessage += `: ${errorData.error?.message || text}`;
        } catch {
          errorMessage += `: ${text}`;
        }
        
        throw new Error(errorMessage);
      }

      const data = JSON.parse(text);
      console.log("✅ Groq Resposta válida recebida");
      
      const content = data.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error("Resposta da API Groq não contém conteúdo válido");
      }
      
      return content;
      
    } catch (error: any) {
      const duration = Date.now() - start;
      
      console.error(`❌ [Groq] Erro após ${duration}ms com modelo ${modelToUse}:`, {
        error: error.message,
        type: error.name,
        stack: error.stack
      });

      LogHelperDetailed.logError(plugin, error, "Erro na chamada da API Groq", {
        operation: "groq_api_call_failed",
        requestBody: payload,
        metadata: { 
          model: modelToUse, 
          endpoint: endpoint,
          duration: duration,
          errorType: error.name
        },
      });

      // Tratamento específico por tipo de erro
      if (error.name === "TimeoutError" || error.name === "AbortError") {
        throw new Error("❌ Timeout na conexão com Groq. Verifique sua internet.");
      } else if (error.message.includes("fetch") || error.message.includes("network")) {
        throw new Error("❌ Erro de rede ao conectar com Groq. Verifique sua conexão.");
      } else if (error.message.includes("401")) {
        throw new Error("❌ API Key Groq inválida. Verifique nas configurações.");
      } else if (error.message.includes("403")) {
        throw new Error("❌ Acesso negado pela Groq. Verifique permissões da API Key.");
      } else if (error.message.includes("429")) {
        throw new Error("❌ Limite de taxa excedido na Groq. Aguarde antes de tentar novamente.");
      } else if (error.message.includes("500") || error.message.includes("502") || error.message.includes("503")) {
        throw new Error("❌ Servidor Groq indisponível. Tente novamente mais tarde.");
      }

      // Tentar fallback se disponível
      if (modelToUse !== fallbackModel && fallbackModel) {
        console.warn(`⚠️ [Groq] Tentando fallback com modelo: ${fallbackModel}`);
        return this.chatWithFallback(prompt, settings, plugin, fallbackModel, "");
      }

      throw error;
    }
  }
}

export interface GroqStreamPayload {
  model: string;
  messages: Array<Message>;
  temperature?: number;
  top_p?: number;
  presence_penalty?: number;
  frequency_penalty?: number;
  max_tokens: number;
  stream: boolean;
}

export interface GroqConfig {
  aiService: string;
  frequency_penalty: number;
  max_tokens: number;
  model: string;
  presence_penalty: number;
  stream: boolean;
  system_commands: string[] | null;
  tags: string[] | null;
  temperature: number;
  title: string;
  top_p: number;
  url: string;
} 