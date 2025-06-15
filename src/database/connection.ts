import sqlite3 from 'sqlite3';
import { promises as fs } from 'fs';
import path from 'path';
import { createLogger } from '../utils/logger';

const logger = createLogger('Database');

export class Database {
  private static instance: Database;
  private db: sqlite3.Database | null = null;
  private dbPath: string;

  private constructor() {
    this.dbPath = process.env.DB_PATH || './data/sfp.db';
  }

  static getInstance(): Database {
    if (!Database.instance) {
      Database.instance = new Database();
    }
    return Database.instance;
  }

  async connect(): Promise<void> {
    if (this.db) {
      return; // Already connected
    }

    try {
      // Ensure data directory exists
      const dataDir = path.dirname(this.dbPath);
      await fs.mkdir(dataDir, { recursive: true });

      this.db = new sqlite3.Database(this.dbPath);
      logger.info(`Connected to SQLite database at ${this.dbPath}`);

      // Initialize schema
      await this.initializeSchema();
    } catch (error) {
      logger.error('Failed to connect to database:', error);
      throw error;
    }
  }

  private async initializeSchema(): Promise<void> {
    if (!this.db) throw new Error('Database not connected');

    try {
      const schemaPath = path.join(__dirname, 'schema.sql');
      const schema = await fs.readFile(schemaPath, 'utf8');
      
      // Split by semicolon and execute each statement
      const statements = schema.split(';').filter(s => s.trim().length > 0);
      
      for (const statement of statements) {
        await this.run(statement);
      }
      
      logger.info('Database schema initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize database schema:', error);
      throw error;
    }
  }

  async run(query: string, params: any[] = []): Promise<{ lastID?: number; changes?: number }> {
    if (!this.db) throw new Error('Database not connected');

    return new Promise((resolve, reject) => {
      this.db!.run(query, params, function(err) {
        if (err) {
          logger.error('Database run error:', err);
          reject(err);
        } else {
          resolve({ lastID: this.lastID, changes: this.changes });
        }
      });
    });
  }

  async get<T = any>(query: string, params: any[] = []): Promise<T | undefined> {
    if (!this.db) throw new Error('Database not connected');

    return new Promise((resolve, reject) => {
      this.db!.get(query, params, (err, row) => {
        if (err) {
          logger.error('Database get error:', err);
          reject(err);
        } else {
          resolve(row as T);
        }
      });
    });
  }

  async all<T = any>(query: string, params: any[] = []): Promise<T[]> {
    if (!this.db) throw new Error('Database not connected');

    return new Promise((resolve, reject) => {
      this.db!.all(query, params, (err, rows) => {
        if (err) {
          logger.error('Database all error:', err);
          reject(err);
        } else {
          resolve(rows as T[]);
        }
      });
    });
  }

  async close(): Promise<void> {
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      this.db!.close((err) => {
        if (err) {
          logger.error('Error closing database:', err);
          reject(err);
        } else {
          logger.info('Database connection closed');
          this.db = null;
          resolve();
        }
      });
    });
  }

  // Transaction support
  async beginTransaction(): Promise<void> {
    await this.run('BEGIN TRANSACTION');
  }

  async commit(): Promise<void> {
    await this.run('COMMIT');
  }

  async rollback(): Promise<void> {
    await this.run('ROLLBACK');
  }

  // Health check
  async healthCheck(): Promise<boolean> {
    try {
      await this.get('SELECT 1');
      return true;
    } catch (error) {
      logger.error('Database health check failed:', error);
      return false;
    }
  }
}