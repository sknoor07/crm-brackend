import {
  users,
  employeeProfiles,
  customerProfiles,
  refreshTokens,
  accountInvitations,
  roles,
  teams,
  userRoles,
  deviceServiceCharges,
  jobs,
  jobItems,
  jobComments,
  jobStatusHistory,
  jobClosures,
  warranties,
  repeatRepairs,
  jobItemQuotes,
  jobItemStatusHistory,
} from './src/db/schema/index.js';

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type EmployeeProfile =
  typeof employeeProfiles.$inferSelect;

export type NewEmployeeProfile =
  typeof employeeProfiles.$inferInsert;

export type CustomerProfile =
  typeof customerProfiles.$inferSelect;

export type NewCustomerProfile =
  typeof customerProfiles.$inferInsert;

export type RefreshToken =
  typeof refreshTokens.$inferSelect;

export type NewRefreshToken =
  typeof refreshTokens.$inferInsert;

export type AccountInvitation =
  typeof accountInvitations.$inferSelect;

export type NewAccountInvitation =
  typeof accountInvitations.$inferInsert;

export type Role = typeof roles.$inferSelect;
export type NewRole = typeof roles.$inferInsert;

export type Team = typeof teams.$inferSelect;
export type NewTeam = typeof teams.$inferInsert;

export type UserRole =
  typeof userRoles.$inferSelect;

export type NewUserRole =
  typeof userRoles.$inferInsert;

export type DeviceServiceCharge =
  typeof deviceServiceCharges.$inferSelect;

export type NewDeviceServiceCharge =
  typeof deviceServiceCharges.$inferInsert;

export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;

export type JobItem =
  typeof jobItems.$inferSelect;

export type NewJobItem =
  typeof jobItems.$inferInsert;

export type JobComment =
  typeof jobComments.$inferSelect;

export type NewJobComment =
  typeof jobComments.$inferInsert;

export type JobStatusHistory =
  typeof jobStatusHistory.$inferSelect;

export type NewJobStatusHistory =
  typeof jobStatusHistory.$inferInsert;

export type JobClosure =
  typeof jobClosures.$inferSelect;

export type NewJobClosure =
  typeof jobClosures.$inferInsert;

export type Warranty =
  typeof warranties.$inferSelect;

export type NewWarranty =
  typeof warranties.$inferInsert;

export type RepeatRepair =
  typeof repeatRepairs.$inferSelect;

export type NewRepeatRepair =
  typeof repeatRepairs.$inferInsert;

export type JobItemQuote =
  typeof jobItemQuotes.$inferSelect;

export type NewJobItemQuote =
  typeof jobItemQuotes.$inferInsert;

export type {
  JobSummaryStatus,
  JobItemStatus,
} from './src/db/schema/job-status.js';

export type JobItemStatusHistory =
  typeof jobItemStatusHistory.$inferSelect;

export type NewJobItemStatusHistory =
  typeof jobItemStatusHistory.$inferInsert;