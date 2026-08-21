import { buildRabbitMqPublish } from './build-rabbitmq-publish';
import type { RabbitMqInfo } from './rabbitmq-collector.interface';

function info(overrides: Partial<RabbitMqInfo> = {}): RabbitMqInfo {
  return { exchange: 'articles.events', routingKey: 'published.LEFIGARO', ...overrides };
}

describe('buildRabbitMqPublish', () => {
  it('emits a channel.publish call with exchange, routing key and payload', () => {
    const snippet = buildRabbitMqPublish(info({ payload: { id: 1 } }));
    expect(snippet).toContain(`channel.publish(`);
    expect(snippet).toContain(`"articles.events"`);
    expect(snippet).toContain(`"published.LEFIGARO"`);
    expect(snippet).toContain(`Buffer.from(JSON.stringify({"id":1}))`);
  });

  it('includes options when headers, messageId or appId are present', () => {
    const snippet = buildRabbitMqPublish(
      info({ headers: { 'x-trace': 'abc' }, messageId: 'mid-1', appId: 'api' }),
    );
    expect(snippet).toContain(`"x-trace": "abc"`);
    expect(snippet).toContain(`"messageId": "mid-1"`);
    expect(snippet).toContain(`"appId": "api"`);
  });

  it('omits the options argument when there is nothing to set', () => {
    const snippet = buildRabbitMqPublish(info({ payload: 'hello' }));
    expect(snippet).not.toContain('headers');
    expect(snippet).not.toContain('messageId');
  });

  it('serializes a missing payload as null', () => {
    expect(buildRabbitMqPublish(info())).toContain(`Buffer.from(JSON.stringify(null))`);
  });
});
