
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Arquivos modificados na versão 5.0.0 baseado no histórico
const modifiedFiles = [
  'src/Services/GroqService.ts',
  'src/Models/Config.ts', 
  'src/main.ts',
  'package.json',
  'manifest.json',
  'versions.json',
  'main.js'
];

// Criar pasta temporária para os arquivos
const tempDir = 'modified-files-v5.0.0';
if (fs.existsSync(tempDir)) {
  fs.rmSync(tempDir, { recursive: true });
}
fs.mkdirSync(tempDir, { recursive: true });

console.log('📁 Copiando arquivos modificados...');

// Copiar arquivos modificados
modifiedFiles.forEach(file => {
  if (fs.existsSync(file)) {
    const destPath = path.join(tempDir, file);
    const destDir = path.dirname(destPath);
    
    // Criar diretório se não existir
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }
    
    fs.copyFileSync(file, destPath);
    console.log(`✅ ${file} -> ${destPath}`);
  } else {
    console.log(`⚠️  Arquivo não encontrado: ${file}`);
  }
});

// Criar arquivo de informações sobre as modificações
const changelogContent = `# Arquivos Modificados - Versão 5.0.0

## Data: ${new Date().toISOString()}

## Arquivos incluídos:
${modifiedFiles.map(file => `- ${file}`).join('\n')}

## Principais mudanças:
- Integração melhorada com Groq API
- Correções no chatbot
- Atualização de versão para 5.0.0
- Melhorias no sistema de logging
- Configurações atualizadas

## Como usar:
1. Extraia os arquivos mantendo a estrutura de pastas
2. Substitua os arquivos correspondentes no projeto original
3. Execute npm install se necessário
4. Rebuild o projeto
`;

fs.writeFileSync(path.join(tempDir, 'MODIFICACOES.md'), changelogContent);

try {
  // Criar ZIP usando comando do sistema
  execSync(`zip -r modified-files-v5.0.0.zip ${tempDir}`, { stdio: 'inherit' });
  console.log('\n🎉 ZIP criado com sucesso: modified-files-v5.0.0.zip');
  
  // Limpar pasta temporária
  fs.rmSync(tempDir, { recursive: true });
  console.log('🧹 Pasta temporária removida');
  
} catch (error) {
  console.error('❌ Erro ao criar ZIP:', error.message);
  console.log('📁 Arquivos copiados para:', tempDir);
}
