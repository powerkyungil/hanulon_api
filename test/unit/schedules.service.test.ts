import { describe, expect, it, vi } from 'vitest';

import { BossesService } from '../../src/modules/bosses/bosses.service';
import { SchedulesRepository } from '../../src/modules/schedules/schedules.repository';
import { SchedulesService } from '../../src/modules/schedules/schedules.service';

describe('schedule correction validation', () => {
  it('rejects a conflicting batch before saving any schedule', () => {
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
      id: key.boss === 'first' ? 1 : 2,
      cooldownHours: 12,
      timeText: null,
      days: null,
      color: null,
      sortOrder: 0,
    }));
    vi.spyOn(repository, 'findByDefinition').mockImplementation((_guild, id) => ({
      id,
      bossDefinitionId: id,
      type: '본섭',
      region: '지역',
      boss: id === 1 ? 'first' : 'second',
      spawnTime: 100,
      isMung: false,
    }));
    vi.spyOn(repository, 'hasRecordedVote').mockImplementation(
      (_guild, input) => input.boss === 'second',
    );
    const save = vi.spyOn(repository, 'saveMany').mockImplementation(() => {});
    const service = new SchedulesService(repository, bosses, 90);
    expect(() =>
      service.saveSchedules(
        1,
        1,
        ['first', 'second'].map((boss) => ({
          type: '본섭',
          region: '지역',
          boss,
          spawnTime: 200,
        })),
      ),
    ).toThrow(expect.objectContaining({ code: 'SCHEDULE_VOTE_CONFLICT', statusCode: 409 }));
    expect(save).not.toHaveBeenCalled();
  });
});
