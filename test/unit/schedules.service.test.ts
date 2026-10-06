import { describe, expect, it, vi } from 'vitest';

import { BossesService } from '../../src/modules/bosses/bosses.service';
import { SchedulesRepository } from '../../src/modules/schedules/schedules.repository';
import { SchedulesService } from '../../src/modules/schedules/schedules.service';

describe('schedule occurrence preservation', () => {
  it('allows re-registering an existing occurrence without relocating its vote records', () => {
    const repository = Object.create(SchedulesRepository.prototype) as SchedulesRepository;
    const bosses = Object.create(BossesService.prototype) as BossesService;
    vi.spyOn(repository, 'findActor').mockReturnValue({
      id: 1,
      guildId: 1,
      role: 'MEMBER',
      nickname: 'member',
      isActive: true,
    });
    vi.spyOn(bosses, 'getDefinition').mockImplementation((_guild, key) => ({
      ...key,
      guildId: _guild,
      id: 1,
      cooldownHours: 12,
      timeText: null,
      days: null,
      color: null,
      sortOrder: 0,
    }));
    const save = vi.spyOn(repository, 'saveMany').mockImplementation(() => {});
    const service = new SchedulesService(repository, bosses, 90);

    expect(() =>
      service.saveSchedules(1, 1, [
        { type: '본섭', region: '지역', boss: 'first', spawnTime: 200 },
      ]),
    ).not.toThrow();
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ id: 1, guildId: 1 }), [
      expect.objectContaining({
        type: '본섭',
        region: '지역',
        boss: 'first',
        spawnTime: 200,
        bossDefinitionId: 1,
      }),
    ]);
  });
});
