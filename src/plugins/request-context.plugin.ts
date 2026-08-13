import type { FastifyInstance } from 'fastify';

export const registerRequestContext = (app: FastifyInstance): void => {
  app.addHook('onSend', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });
};
