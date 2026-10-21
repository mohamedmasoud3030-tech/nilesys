/**
 * Nile API application factory (NestJS + Fastify, ADR-0001).
 * Used identically by main.ts (real server) and the end-to-end tests.
 */
import 'reflect-metadata';
import { Module, type DynamicModule } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { CatalogController, CheckoutController, HealthController, MeController, RefundsController, ReportsController, SalesController, ShiftsController } from './controllers.js';
import { DEPS, type Deps } from './deps.js';
import { webHeaders } from './http.js';

@Module({})
class AppModule {
  static register(deps: Deps): DynamicModule {
    return {
      module: AppModule,
      controllers: [HealthController, MeController, CatalogController, SalesController, CheckoutController, ShiftsController, RefundsController, ReportsController],
      providers: [{ provide: DEPS, useValue: deps }],
    };
  }
}

/**
 * ADR-0005 §8: mount Better Auth's core web handler under Fastify. Fastify has
 * already consumed the body stream, so the parsed body is re-serialized into
 * a web Request. Multiple Set-Cookie headers are preserved.
 */
function mountAuth(app: NestFastifyApplication, deps: Deps): void {
  const fastify = app.getHttpAdapter().getInstance();
  fastify.route({
    method: ['GET', 'POST'],
    url: '/api/auth/*',
    async handler(req: FastifyRequest, reply: FastifyReply) {
      const proto = (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0] ?? req.protocol;
      const url = new URL(req.url, `${proto}://${req.headers.host ?? 'localhost'}`);
      const hasBody = req.method !== 'GET' && req.body !== undefined && req.body !== null;
      const res = await deps.auth.handler(
        new Request(url, { method: req.method, headers: webHeaders(req), body: hasBody ? JSON.stringify(req.body) : undefined }),
      );
      reply.status(res.status);
      res.headers.forEach((value, key) => {
        if (key.toLowerCase() !== 'set-cookie') reply.header(key, value);
      });
      const cookies = res.headers.getSetCookie();
      if (cookies.length) reply.header('set-cookie', cookies);
      reply.send(res.body ? await res.text() : null);
    },
  });
}

export interface CreatedApp {
  app: NestFastifyApplication;
  openapi: OpenAPIObject;
}

export async function createApp(deps: Deps, opts: { logger?: boolean; serveWeb?: boolean } = {}): Promise<CreatedApp> {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule.register(deps), new FastifyAdapter({ trustProxy: true }), {
    logger: opts.logger === false ? false : ['error', 'warn', 'log'],
  });
  mountAuth(app, deps);
  // واجهة كاشير R1 (apps/web): تُسجَّل قبل init لأن Fastify يرفض مسارات بعده.
  // ملفات ثابتة فقط على /pos — لا منطق بيزنس؛ كل شيء عبر /api/v1.
  if (opts.serveWeb) {
    const { readFile } = await import('node:fs/promises');
    const webDir = new URL('../../web/', import.meta.url);
    const files: Array<[string, string, string]> = [
      ['/pos', 'index.html', 'text/html; charset=utf-8'],
      ['/pos/app.js', 'app.js', 'text/javascript; charset=utf-8'],
      ['/pos/styles.css', 'styles.css', 'text/css; charset=utf-8'],
    ];
    const fastify = app.getHttpAdapter().getInstance();
    for (const [route, file, type] of files) {
      fastify.get(route, async (_req, reply) => {
        reply.type(type);
        return readFile(new URL(file, webDir), 'utf8');
      });
    }
  }
  const openapi = SwaggerModule.createDocument(
    app,
    new DocumentBuilder().setTitle('Nile API').setVersion('0.1.0').addCookieAuth('better-auth.session_token').build(),
  );
  app.getHttpAdapter().getInstance().get('/api/openapi.json', async () => openapi);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return { app, openapi };
}
