import { z } from 'zod';

// Saved JSON body used by Master::settingsCallback. No ROS imports/transports.
const finite = z.number().finite();
const common = {
  linear_velocity: finite,
  max_angular_velocity: finite,
  min_angular_velocity: finite,
  interpolated_points: finite.int().positive().max(Number.MAX_SAFE_INTEGER),
};
export const pioneerSettingsSchema = z.discriminatedUnion('algorithm', [
  z.object({ algorithm: z.literal('PURE_PURSUIT'), ...common,
    lookahead_distance: finite.positive(),
  }).strict(),
  z.object({ algorithm: z.literal('MPC'), ...common,
    horizon: finite.int().positive().max(Number.MAX_SAFE_INTEGER), dt: finite.positive(),
    weightPos: finite.nonnegative(), weightHeading: finite.nonnegative(), weightEffort: finite.positive(),
  }).strict(),
]).refine(settings => settings.min_angular_velocity <= settings.max_angular_velocity,
  'min_angular_velocity must not exceed max_angular_velocity');
