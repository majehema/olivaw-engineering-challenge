import { z } from "zod";

export const ROBOT_STATUSES = ["idle", "moving", "charging", "error"] as const;
export type RobotStatus = (typeof ROBOT_STATUSES)[number];

const identifier = z.string().trim().min(1).max(64);

// Wire format sent by robots. Unknown fields are stripped rather than rejected,
// so robots running newer firmware that sends extra fields keep working.
export const telemetrySchema = z.object({
  robotId: identifier,
  siteId: identifier,
  timestamp: z.iso.datetime({ offset: true }).transform((value) => Date.parse(value)),
  battery: z.number().min(0).max(100),
  position: z.object({ x: z.number(), y: z.number() }),
  status: z.enum(ROBOT_STATUSES),
});

/** Telemetry as sent over the wire (ISO 8601 timestamp). */
export type TelemetryInput = z.input<typeof telemetrySchema>;

/** Validated telemetry. `timestamp` is epoch milliseconds from the robot's clock. */
export type Telemetry = z.output<typeof telemetrySchema>;
