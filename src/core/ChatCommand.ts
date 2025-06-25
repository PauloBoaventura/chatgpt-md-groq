import { ChatSession } from "./ChatSession";
import { GroqService } from "../Services/GroqService";
import { Plugin, Editor, MarkdownView, MarkdownFileInfo, Notice } from "obsidian";
import { DEFAULT_GROQ_CONFIG } from "../Services/GroqService";
import { Message } from "../Models/Message";
import { ErrorService } from "../Services/ErrorService";
import { NotificationService } from "../Services/NotificationService";
import { ApiService } from "../Services/ApiService";
import { ApiAuthService } from "../Services/ApiAuthService";
import { ApiResponseParser } from "../Services/ApiResponseParser";
import { ChatGPT_MDSettings } from "src/Models/Config";

const chat = new ChatSession();

// Criar instâncias dos serviços necessários
const notificationService = new NotificationService();
const errorService = new ErrorService(notificationService);
const apiService = new ApiService(errorService, notificationService);
const apiAuthService = new ApiAuthService(notificationService);
const apiResponseParser = new ApiResponseParser(notificationService);

// Criar instância do GroqService com todos os serviços
const groq = new GroqService(
  errorService,
  notificationService,
  apiService,
  apiAuthService,
  apiResponseParser
);

export function registerChatCommand(plugin: Plugin) {
  plugin.addCommand({
    id: "enviar-msg-groq",
    name: "Enviar mensagem ao chatbot Groq",
    icon: "message-circle",
    editorCallback: async (editor: Editor, ctx: MarkdownView | MarkdownFileInfo) => {
      let input: string = "";

      try {
        // Obter as configurações do plugin
        const settings = (plugin as any).serviceLocator.getSettingsService().getSettings() as ChatGPT_MDSettings;

        // Obter o texto selecionado ou todo o conteúdo
        input = editor.getSelection() || editor.getValue();

        if (!input.trim()) {
          new Notice("⚠️ Por favor, selecione um texto ou digite uma mensagem.");
          return;
        }

        // Adicionar mensagem do usuário ao histórico
        chat.addMessage("user", input);

        // Mostrar notificação de processamento
        new Notice("🤖 Processando com Groq...");

        // Preparar mensagens para a API
        const messages: Message[] = chat.getMessages().map(msg => ({
          role: msg.role,
          content: msg.content
        }));

        // Configuração do Groq a partir das configurações do plugin
        const config = {
          ...DEFAULT_GROQ_CONFIG,
          ...settings.groq, // Sobrescreve o padrão com as configurações do usuário
          stream: false // Forçar não-streaming para este comando
        };

        // Chamar a API do Groq
        const apiKey = settings.groqApiKey;
        const response = await groq.callAIAPI(
          messages,
          config,
          "🤖 ",
          config.url,
          editor,
          false, // generateAtCursor
          apiKey, // apiKey (será obtido das configurações)
          settings // settings
        );

        // Processar resposta
        if (response && response.fullString) {
          const output = response.fullString.replace(/^🤖\s*/, "").trim();
          chat.addMessage("assistant", output);

          // Inserir resposta no editor
          const currentContent = editor.getValue();
          const newContent = currentContent + `\n\n👤: ${input}\n🤖: ${output}\n`;
          editor.setValue(newContent);

          new Notice("✅ Resposta do Groq inserida!");
        } else {
          throw new Error("Resposta vazia da API");
        }

      } catch (error: unknown) {
        console.error("Erro no chat interativo:", error);
        const errorMessage = error instanceof Error ? error.message : "Falha na comunicação com Groq";
        new Notice(`❌ Erro: ${errorMessage}`);

        // Em caso de erro, adicionar uma resposta de fallback
        const fallbackResponse = "⚠️ Desculpe, não consegui processar sua mensagem. Verifique sua conexão e tente novamente.";
        chat.addMessage("assistant", fallbackResponse);

        if (input) {
          const currentContent = editor.getValue();
          const newContent = currentContent + `\n\n👤: ${input}\n🤖: ${fallbackResponse}\n`;
          editor.setValue(newContent);
        }
      }
    }
  });

  // Comando adicional para limpar o histórico do chat
  plugin.addCommand({
    id: "limpar-historico-chat",
    name: "Limpar histórico do chat",
    icon: "trash-2",
    callback: () => {
      chat.reset();
      new Notice("🧹 Histórico do chat limpo!");
    }
  });

  plugin.addCommand({
    id: 'interactive-chat',
    name: 'Chat Interativo com Groq',
    editorCallback: async (editor: Editor, view: MarkdownView) => {
      try {
        // Obter configurações do plugin
        const settingsService = (plugin as any).serviceLocator?.getSettingsService();
        if (!settingsService) {
          new Notice("❌ Serviço de configurações não disponível");
          return;
        }

        const settings = settingsService.getSettings();

        // Verificar se a API Key está configurada
        if (!settings.groqApiKey) {
          new Notice("❌ Configure a API Key do Groq nas configurações do plugin");
          return;
        }

        // Inicializar o ChatController com as configurações atuais
        const { initializeChatController } = await import('./ChatController');
        initializeChatController(settings, plugin);

      } catch (error) {
        console.error("Erro ao iniciar o chat interativo:", error);
        new Notice(`❌ Erro ao iniciar o chat interativo: ${error.message}`);
      }
    }
  });
}