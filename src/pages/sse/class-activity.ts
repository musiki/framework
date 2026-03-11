import type { APIRoute } from 'astro';
import { canonicalizeCourseId } from '../../lib/course-alias';
import { buildClassActivitySnapshot } from '../../lib/class-activity/model.mjs';
import {
  cleanupExpiredInteractions,
  getLiveSnapshot,
  subscribeToLiveEvents,
} from '../../lib/live/server-store.mjs';

const encoder = new TextEncoder();

const toSseChunk = (eventName: string, payload: unknown) => {
  const body = JSON.stringify(payload ?? {});
  return encoder.encode(`event: ${eventName}\ndata: ${body}\n\n`);
};

const toCommentChunk = (message = 'keepalive') =>
  encoder.encode(`: ${message}\n\n`);

export const GET: APIRoute = async ({ request, url }) => {
  const requestedCourseId = String(url.searchParams.get('courseId') || '').trim();
  const courseId = await canonicalizeCourseId(requestedCourseId);

  let unsubscribe: null | (() => void) = null;
  let heartbeatId: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = () => {
        controller.enqueue(
          toSseChunk('class.activity', buildClassActivitySnapshot(getLiveSnapshot(courseId))),
        );
      };

      const close = () => {
        if (unsubscribe) {
          unsubscribe();
          unsubscribe = null;
        }
        if (heartbeatId) {
          clearInterval(heartbeatId);
          heartbeatId = null;
        }
        try {
          controller.close();
        } catch {
          // stream might already be closed
        }
      };

      cleanupExpiredInteractions();
      send();

      unsubscribe = subscribeToLiveEvents({
        courseId,
        callback: () => {
          send();
        },
      });

      heartbeatId = setInterval(() => {
        cleanupExpiredInteractions();
        controller.enqueue(toCommentChunk());
      }, 25_000);

      request.signal.addEventListener('abort', close, { once: true });
    },
    cancel() {
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
      if (heartbeatId) {
        clearInterval(heartbeatId);
        heartbeatId = null;
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
};
