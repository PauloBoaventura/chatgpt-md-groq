import { ChatSession } from "./ChatSession";
import { GroqService } from "../Services/GroqService";
import { ErrorService } from "../Services/ErrorService";
import { NotificationService } from "../Services/NotificationService";
import { ApiService } from "../Services/ApiService";
import { ApiAuthService } from "../Services/ApiAuthService";
import { ApiResponseParser } from "../Services/ApiResponseParser";
import { Message } from "../Models/Message";
import { DEFAULT_GROQ_CONFIG } from "../Services/GroqService";
import { ChatGPT_MDSettings } from "../Models/Config";
import { Plugin } from "obsidian";

const chat = new ChatSession();

// Variáveis globais para manter as instâncias
let groqService: GroqService | null = null;
let currentSettings: ChatGPT_MDSettings | null = null;
let currentPlugin: Plugin | null = null;

// Função para inicializar o controller com configurações
export function initializeChatController(settings: ChatGPT_MDSettings, plugin: Plugin): void {
  currentSettings = settings;
  currentPlugin = plugin;
  
  console.log("[ChatController] Inicializando com configurações:", {
    hasGroqApiKey: !!settings.groqApiKey,
    groqUrl: settings.groqUrl || "padrão"
  });

  // Criar instâncias dos serviços necessários
  const notificationService = new NotificationService();
  const errorService = new ErrorService(notificationService);
  const apiService = new ApiService(errorService, notificationService);
  const apiAuthService = new ApiAuthService(notificationService);
  const apiResponseParser = new ApiResponseParser(notificationService);

  // Criar instância do GroqService com todos os serviços
  groqService = new GroqService(
    errorService,
    notificationService,
    apiService,
    apiAuthService,
    apiResponseParser
  );
}

export async function handleChatInteraction(input: string, settings?: ChatGPT_MDSettings, plugin?: Plugin): Promise<string> {
  try {
    // Usar configurações fornecidas ou as globais
    const settingsToUse = settings || currentSettings;
    const pluginToUse = plugin || currentPlugin;
    
    if (!settingsToUse) {
      throw new Error("❌ Configurações não disponíveis. Inicialize o ChatController primeiro.");
    }

    if (!pluginToUse) {
      throw new Error("❌ Plugin não disponível. Inicialize o ChatController primeiro.");
    }

    // Verificar se o GroqService foi inicializado
    if (!groqService) {
      console.log("[ChatController] GroqService não inicializado, criando novo...");
      initializeChatController(settingsToUse, pluginToUse);
    }

    if (!groqService) {
      throw new Error("❌ Falha ao inicializar GroqService");
    }

    console.log("[ChatController] Processando input:", input.substring(0, 50) + "...");

    // Adicionar mensagem do usuário ao histórico
    chat.addMessage("user", input);

    // Usar o método chatWithFallback que tem melhor tratamento de erro
    const response = await groqService.chatWithFallback(
      input,
      settingsToUse,
      pluginToUse,
      "mixtral-8x7b-32768"
    );

    if (response && response.trim()) {
      const output = response.trim();
      chat.addMessage("assistant", output);
      console.log("[ChatController] Resposta recebida com sucesso");
      return output;
    } else {
      throw new Error("Resposta vazia da API Groq");
    }

  } catch (error: unknown) {
    console.error("[ChatController] Erro no chat interativo:", error);
    const errorMessage = error instanceof Error ? error.message : "Falha na comunicação com Groq";
    
    // Em caso de erro, retornar uma resposta de fallback
    const fallbackResponse = `⚠️ Erro: ${errorMessage}`;
    chat.addMessage("assistant", fallbackResponse);
    
    return fallbackResponse;
  }
}

export function resetChat(): void {
  chat.reset();
} 