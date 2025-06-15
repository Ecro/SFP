export interface Logger {
  info: (message: string, ...args: any[]) => void;
  warn: (message: string, ...args: any[]) => void;
  error: (message: string, ...args: any[]) => void;
  debug: (message: string, ...args: any[]) => void;
}

export function createLogger(context: string): Logger {
  const timestamp = () => new Date().toISOString();
  
  return {
    info: (message: string, ...args: any[]) => {
      console.log(`[${timestamp()}] [INFO] [${context}] ${message}`, ...args);
    },
    warn: (message: string, ...args: any[]) => {
      console.warn(`[${timestamp()}] [WARN] [${context}] ${message}`, ...args);
    },
    error: (message: string, ...args: any[]) => {
      console.error(`[${timestamp()}] [ERROR] [${context}] ${message}`, ...args);
    },
    debug: (message: string, ...args: any[]) => {
      if (process.env.NODE_ENV === 'development' || process.env.LOG_LEVEL === 'debug') {
        console.debug(`[${timestamp()}] [DEBUG] [${context}] ${message}`, ...args);
      }
    }
  };
}