import { SpanStatusCode } from '@opentelemetry/api';
import { NodeTracerProvider, SimpleSpanProcessor, type SpanExporter, type ReadableSpan } from '@opentelemetry/sdk-trace-node';
import { GateError } from './errors.js';
type Event = { name: string; traceId: string; durationMs: number; status: number; code?: string };
class LocalExporter implements SpanExporter {
  records: Event[] = [];
  export(spans: ReadableSpan[], done: Parameters<SpanExporter['export']>[1]) {
    this.records.push(...spans.map(s => ({
      name: s.name, traceId: s.spanContext().traceId,
      durationMs: s.duration[0] * 1000 + s.duration[1] / 1000000,
      status: s.status.code, ...(s.attributes['gate.code'] ? { code: String(s.attributes['gate.code']) } : {}),
    })));
    this.records = this.records.slice(-1000);
    done({ code: 0 });
  }
  async shutdown() {}
  async forceFlush() {}
}
export class Telemetry {
  private exporter = new LocalExporter();
  private provider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(this.exporter)] });
  private tracer = this.provider.getTracer('governed-analytics-agent', '0.1.0');
  async observe<T>(name: string, work: () => T | Promise<T>): Promise<T> {
    const span = this.tracer.startSpan(name);
    try {
      const result = await work(); span.setStatus({ code: SpanStatusCode.OK }); return result;
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR });
      span.setAttribute('gate.code', error instanceof GateError ? error.code : 'internal');
      throw error;
    } finally { span.end(); }
  }
  async records() { await this.provider.forceFlush(); return structuredClone(this.exporter.records); }
  async close() { await this.provider.shutdown(); }
}

