import * as path from 'node:path';
import { ClientAssetRegistry, TemplateRendererService } from '@eleven-labs/nest-profiler';
import type { Profile } from '@eleven-labs/nest-profiler';
import { COMMAND_ENTRYPOINT_TYPE } from './commander-collector.interface';
import type { CommandInfo } from './commander-collector.interface';

function profileWith(data: Partial<CommandInfo>): Profile<CommandInfo> {
  return {
    token: 'abcdef1234',
    createdAt: 0,
    entrypoint: {
      type: COMMAND_ENTRYPOINT_TYPE,
      data: { name: 'demo:greet', arguments: [], success: true, ...data },
    },
    performance: { startTime: 0, duration: 12, heapUsed: 0 },
    logs: [],
    exceptions: [],
    collectors: {},
  };
}

describe('command detail tab template', () => {
  let service: TemplateRendererService;

  beforeEach(() => {
    service = new TemplateRendererService(new ClientAssetRegistry());
    service.registerDir(path.join(__dirname, 'templates'));
  });

  it('rebuilds the full invocation and lists arguments and options separately', async () => {
    const html = await service.render('command', {
      profile: profileWith({
        arguments: ['Grace'],
        options: { name: 'Ada', dryRun: true, retries: 3, verbose: false },
      }),
    });

    // The Command block is the invocation as typed — arguments *and* options.
    expect(html).toContain('demo:greet Grace --name Ada --dry-run --retries 3');
    // A falsy flag is not part of the invocation, but the parsed value is still listed below.
    expect(html).not.toContain('--verbose');
    expect(html).toContain('Grace');
    expect(html).toContain('Arguments');
    expect(html).toContain('Options');
  });

  it('shows the empty states when the command took neither arguments nor options', async () => {
    const html = await service.render('command', { profile: profileWith({}) });

    expect(html).toContain('No positional arguments.');
    expect(html).toContain('No options.');
  });
});
