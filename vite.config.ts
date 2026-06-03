/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { spawn } from 'node:child_process'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin, ViteDevServer } from 'vite'

function marketDataFetchPlugin(): Plugin {
  return {
    name: 'market-data-fetch-api',
    configureServer(server: ViteDevServer) {
      server.middlewares.use('/api/fetch-market-data', (
        req: IncomingMessage,
        res: ServerResponse,
        next: () => void,
      ) => {
        if (req.method !== 'POST') {
          next()
          return
        }

        const child = spawn(
          'npm',
          ['run', 'fetch:market-data'],
          {
            cwd: process.cwd(),
            shell: process.platform === 'win32',
          },
        )
        let stdout = ''
        let stderr = ''

        child.stdout.on('data', (chunk: Buffer) => {
          stdout += chunk.toString()
        })
        child.stderr.on('data', (chunk: Buffer) => {
          stderr += chunk.toString()
        })
        child.on('close', (code) => {
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.statusCode = code === 0 ? 200 : 500
          res.end(
            JSON.stringify({
              ok: code === 0,
              code,
              stdout,
              stderr,
            }),
          )
        })
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), marketDataFetchPlugin()],
  test: {
    environment: 'node',
    globals: false,
    include: ['src/**/*.test.ts'],
  },
})
