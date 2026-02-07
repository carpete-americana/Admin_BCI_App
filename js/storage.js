require('dotenv').config()
const { app } = require('electron')
const path = require('path')
const crypto = require('crypto')
const fs = require('fs')
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;

// Versão do formato de encriptação (para migração futura)
const ENCRYPTION_VERSION = 2;

class ElectronStorage {
  constructor() {
    this.userDataPath = app.getPath('userData')
    this.storagePath = path.join(this.userDataPath, 'admin-app-storage.json')
    this.keyPath = path.join(this.userDataPath, 'admin-encryption.key')
    this.data = this.loadData()
    
    // Carrega ou gera chave de encriptação
    const encryptionKey = this.getOrCreateEncryptionKey()
    
    this.algorithm = 'aes-256-gcm' // GCM é mais seguro que CBC
    this.key = crypto.scryptSync(encryptionKey, encryptionKey.slice(0, 16), 32)
    
    // Migrar dados antigos se necessário
    this.migrateOldData()
  }
  
  /**
   * Migra dados do formato antigo (IV fixo) para o novo (IV aleatório)
   */
  migrateOldData() {
    if (this.data._encryptionVersion === ENCRYPTION_VERSION) {
      return; // Já está no formato novo
    }
    
    try {
      // Tenta desencriptar com formato antigo e re-encriptar
      const oldData = { ...this.data };
      delete oldData._encryptionVersion;
      
      let needsMigration = false;
      const newData = { _encryptionVersion: ENCRYPTION_VERSION };
      
      for (const [key, value] of Object.entries(oldData)) {
        if (typeof value === 'string' && !value.includes(':')) {
          // Formato antigo (sem IV prefixado)
          try {
            const decrypted = this.decryptLegacy(value);
            if (decrypted) {
              newData[key] = this.encrypt(decrypted);
              needsMigration = true;
            }
          } catch (e) {
            // Não é formato antigo ou está corrompido, mantém
            newData[key] = value;
          }
        } else {
          newData[key] = value;
        }
      }
      
      if (needsMigration) {
        this.data = newData;
        this.saveData();
        console.log('[ADMIN-STORAGE] Migrated to new encryption format');
      } else {
        this.data._encryptionVersion = ENCRYPTION_VERSION;
        this.saveData();
      }
    } catch (e) {
      console.warn('[ADMIN-STORAGE] Migration failed, starting fresh:', e.message);
      this.data = { _encryptionVersion: ENCRYPTION_VERSION };
      this.saveData();
    }
  }
  
  /**
   * Desencripta dados no formato antigo (IV fixo)
   */
  decryptLegacy(text) {
    try {
      const iv = Buffer.alloc(16, 0); // IV fixo antigo
      const decipher = crypto.createDecipheriv('aes-256-cbc', this.key, iv);
      let decrypted = decipher.update(text, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch (e) {
      return null;
    }
  }

  getOrCreateEncryptionKey() {
    // Prioridade 1: Variável de ambiente (desenvolvimento)
    if (ENCRYPTION_KEY && ENCRYPTION_KEY.length >= 16) {
      return ENCRYPTION_KEY
    }
    
    // Prioridade 2: Ficheiro local (produção)
    try {
      if (fs.existsSync(this.keyPath)) {
        const key = fs.readFileSync(this.keyPath, 'utf-8').trim()
        if (key.length >= 16) return key
      }
    } catch (e) {
      console.warn('Could not read encryption key file:', e.message)
    }
    
    // Prioridade 3: Gerar nova chave
    const newKey = crypto.randomBytes(32).toString('hex')
    try {
      fs.writeFileSync(this.keyPath, newKey, 'utf-8')
      console.log('Generated new admin encryption key')
    } catch (e) {
      console.error('Could not save encryption key:', e.message)
    }
    
    return newKey
  }

  loadData() {
    try {
      return JSON.parse(fs.readFileSync(this.storagePath, 'utf-8'))
    } catch (e) {
      return {}
    }
  }

  saveData() {
    fs.writeFileSync(this.storagePath, JSON.stringify(this.data))
  }

  setItem(key, value) {
    this.data[key] = this.encrypt(JSON.stringify(value))
    this.saveData()
  }

  getItem(key) {
    const value = this.data[key]
    return value ? JSON.parse(this.decrypt(value)) : null
  }

  removeItem(key) {
    delete this.data[key]
    this.saveData()
  }

  encrypt(text) {
    // Gera IV aleatório para cada encriptação (12 bytes para GCM)
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(this.algorithm, this.key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    // Formato: iv:authTag:encrypted
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
  }

  decrypt(text) {
    try {
      // Verifica se é formato novo (com IV prefixado)
      if (text.includes(':')) {
        const parts = text.split(':');
        if (parts.length === 3) {
          const [ivHex, authTagHex, encrypted] = parts;
          const iv = Buffer.from(ivHex, 'hex');
          const authTag = Buffer.from(authTagHex, 'hex');
          const decipher = crypto.createDecipheriv(this.algorithm, this.key, iv);
          decipher.setAuthTag(authTag);
          let decrypted = decipher.update(encrypted, 'hex', 'utf8');
          decrypted += decipher.final('utf8');
          return decrypted;
        }
      }
      
      // Fallback para formato antigo
      return this.decryptLegacy(text);
    } catch (error) {
      console.error('[ADMIN-STORAGE] Erro ao desencriptar:', error.message);
      this.clearStorage();
      return null;
    }
  }

  clearStorage() {
    try {
      if (fs.existsSync(this.storagePath)) {
        fs.unlinkSync(this.storagePath); // Deleta o arquivo
        this.data = {}; // Reseta os dados em memória
        console.log('Admin storage apagado com sucesso!');
      }
    } catch (error) {
      console.error('Erro ao apagar admin storage:', error);
    }
  }
}

// Exporta uma instância única
module.exports = new ElectronStorage()
