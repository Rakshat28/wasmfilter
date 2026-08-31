/* eslint-disable no-console */
export const log = {
  info: (scope: string, message: string, data?: unknown): void => {
    if (data !== undefined) console.info(`[${scope}] ${message}`, data);
    else console.info(`[${scope}] ${message}`);
  },
  warn: (scope: string, message: string, data?: unknown): void => {
    if (data !== undefined) console.warn(`[${scope}] ${message}`, data);
    else console.warn(`[${scope}] ${message}`);
  },
  error: (scope: string, message: string, data?: unknown): void => {
    if (data !== undefined) console.error(`[${scope}] ${message}`, data);
    else console.error(`[${scope}] ${message}`);
  },
};
