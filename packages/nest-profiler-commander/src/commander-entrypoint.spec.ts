import type { Profile } from '@eleven-labs/nest-profiler';
import { COMMAND_ENTRYPOINT_TYPE_DEF } from './commander-entrypoint';
import { COMMAND_ENTRYPOINT_TYPE } from './commander-collector.interface';
import type { CommandInfo } from './commander-collector.interface';

function makeProfile(data: CommandInfo): Profile<CommandInfo> {
  return {
    token: 'tok',
    createdAt: 0,
    entrypoint: { type: COMMAND_ENTRYPOINT_TYPE, data },
    performance: { startTime: 0, heapUsed: 0 },
    logs: [],
    exceptions: [],
    collectors: {},
  };
}

describe('COMMAND_ENTRYPOINT_TYPE_DEF', () => {
  it('describes the command entrypoint type', () => {
    expect(COMMAND_ENTRYPOINT_TYPE_DEF.type).toBe(COMMAND_ENTRYPOINT_TYPE);
    expect(COMMAND_ENTRYPOINT_TYPE_DEF.label).toBe('Command');
    expect(COMMAND_ENTRYPOINT_TYPE_DEF.listSection.templatePath).toMatch(/commands-section\.ejs$/);
    expect(COMMAND_ENTRYPOINT_TYPE_DEF.detailTabs).toHaveLength(1);
    expect(COMMAND_ENTRYPOINT_TYPE_DEF.detailTabs[0]?.name).toBe('command');
    expect(COMMAND_ENTRYPOINT_TYPE_DEF.detailTabs[0]?.templatePath).toMatch(/command\.ejs$/);
  });

  describe('commandStatus filter', () => {
    const filter = COMMAND_ENTRYPOINT_TYPE_DEF.listFilters?.find((f) => f.key === 'commandStatus');
    const ok = makeProfile({ name: 'a', arguments: [], exitCode: 0, success: true });
    const ko = makeProfile({ name: 'b', arguments: [], exitCode: 1, success: false });

    it('is contributed as a select control', () => {
      expect(filter?.control).toBe('select');
    });

    it('matches successful runs for "success" and failed runs for "failed"', () => {
      expect(filter?.matches(ok, 'success')).toBe(true);
      expect(filter?.matches(ko, 'success')).toBe(false);
      expect(filter?.matches(ko, 'failed')).toBe(true);
      expect(filter?.matches(ok, 'failed')).toBe(false);
    });

    it('is inactive for an empty value', () => {
      expect(filter?.parse('')).toBeUndefined();
    });

    it('keeps a non-empty value as the active filter', () => {
      expect(filter?.parse('success')).toBe('success');
    });
  });

  describe('summary', () => {
    it('includes the joined arguments when present', () => {
      const profile = makeProfile({
        name: 'sync:posts',
        arguments: ['--limit', '3'],
        exitCode: 0,
        success: true,
      });
      expect(COMMAND_ENTRYPOINT_TYPE_DEF.summary(profile)).toEqual({
        badge: 'CLI',
        badgeClass: 'badge-default',
        text: 'sync:posts --limit 3',
      });
    });

    it('omits the arguments suffix when there are none', () => {
      const profile = makeProfile({
        name: 'demo:greet',
        arguments: [],
        exitCode: 0,
        success: true,
      });
      expect(COMMAND_ENTRYPOINT_TYPE_DEF.summary(profile).text).toBe('demo:greet');
    });
  });
});
