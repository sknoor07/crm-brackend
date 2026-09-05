import { and, eq } from 'drizzle-orm';

import { db } from '../config/database.js';

import {
  customerProfiles,
  deviceServiceCharges,
  employeeProfiles,
  roles,
  userRoles,
  users,
} from './schema/index.js';

import { hashPassword } from '../shared/utils/password.js';

const testPassword = 'TestPassword123!';

const roleSeeds = [
  {
    name: 'admin',
    description: 'Full administrative access',
  },
  {
    name: 'customer',
    description: 'Create requests and approve quotes',
  },
  {
    name: 'customer_service',
    description: 'Manage customer requests and quotes',
  },
  {
    name: 'transport_manager',
    description: 'Manage pickup and delivery operations',
  },
  {
    name: 'pickup_person',
    description: 'Handle device pickup and delivery',
  },
  {
    name: 'repair_manager',
    description: 'Manage repair assignments',
  },
  {
    name: 'repair_person',
    description: 'Perform repair work',
  },
] as const;

const categorySeeds = [
  {
    deviceCategory: 'laptop',
    chargeAmount: '1500.00',
  },
  {
    deviceCategory: 'desktop',
    chargeAmount: '1200.00',
  },
  {
    deviceCategory: 'macbook',
    chargeAmount: '2500.00',
  },
  {
    deviceCategory: 'mobile_phone',
    chargeAmount: '1000.00',
  },
  {
    deviceCategory: 'tablet',
    chargeAmount: '1200.00',
  },
] as const;

const userSeeds = [
  {
    email: 'admin@test.example.com',
    firstName: 'Test',
    lastName: 'Admin',
    role: 'admin',
    userType: 'employee',
  },
  {
    email: 'customer@test.example.com',
    firstName: 'Test',
    lastName: 'Customer',
    role: 'customer',
    userType: 'customer',
  },
  {
    email: 'customer-service@test.example.com',
    firstName: 'Test',
    lastName: 'Customer Service',
    role: 'customer_service',
    userType: 'employee',
  },
  {
    email: 'transport-manager@test.example.com',
    firstName: 'Test',
    lastName: 'Transport Manager',
    role: 'transport_manager',
    userType: 'employee',
  },
  {
    email: 'pickup-person@test.example.com',
    firstName: 'Test',
    lastName: 'Pickup Person',
    role: 'pickup_person',
    userType: 'employee',
  },
  {
    email: 'repair-manager@test.example.com',
    firstName: 'Test',
    lastName: 'Repair Manager',
    role: 'repair_manager',
    userType: 'employee',
  },
  {
    email: 'repair-person@test.example.com',
    firstName: 'Test',
    lastName: 'Repair Person',
    role: 'repair_person',
    userType: 'employee',
  },
] as const;

const seed = async () => {
  await db.transaction(async (tx) => {

    // --------------------------------
    // ROLES
    // --------------------------------

    const roleIds = new Map<string, string>();

    for (const role of roleSeeds) {
      const [roleRow] = await tx
        .insert(roles)
        .values(role)
        .onConflictDoUpdate({
          target: roles.name,
          set: {
            description: role.description,
          },
        })
        .returning({
          id: roles.id,
          name: roles.name,
        });

      roleIds.set(roleRow.name, roleRow.id);
    }


    // --------------------------------
    // DEVICE SERVICE CHARGES
    // --------------------------------

    for (const category of categorySeeds) {
      await tx
        .insert(deviceServiceCharges)
        .values(category)
        .onConflictDoUpdate({
          target: deviceServiceCharges.deviceCategory,
          set: {
            chargeAmount: category.chargeAmount,
          },
        });
    }


    // --------------------------------
    // USERS
    // --------------------------------

    const passwordHash =
      await hashPassword(testPassword);

    for (const userSeed of userSeeds) {

      const [user] = await tx
        .insert(users)
        .values({
          email: userSeed.email,
          passwordHash,
          userType: userSeed.userType,
          mustChangePassword: false,
        })
        .onConflictDoUpdate({
          target: users.email,
          set: {
            passwordHash,
            userType: userSeed.userType,
            isActive: true,
            mustChangePassword: false,
          },
        })
        .returning({
          id: users.id,
        });


      // --------------------------------
      // PROFILE
      // --------------------------------

      if (userSeed.userType === 'employee') {

        await tx
          .insert(employeeProfiles)
          .values({
            userId: user.id,
            firstName: userSeed.firstName,
            lastName: userSeed.lastName,
          })
          .onConflictDoUpdate({
            target: employeeProfiles.userId,
            set: {
              firstName: userSeed.firstName,
              lastName: userSeed.lastName,
            },
          });

      } else {

        await tx
          .insert(customerProfiles)
          .values({
            userId: user.id,
            firstName: userSeed.firstName,
            lastName: userSeed.lastName,
          })
          .onConflictDoUpdate({
            target: customerProfiles.userId,
            set: {
              firstName: userSeed.firstName,
              lastName: userSeed.lastName,
            },
          });
      }


      // --------------------------------
      // ROLE
      // --------------------------------

      const roleId = roleIds.get(
        userSeed.role,
      );

      if (!roleId) {
        throw new Error(
          `Role was not seeded: ${userSeed.role}`,
        );
      }

      const existingAssignment =
        await tx
          .select({
            id: userRoles.id,
          })
          .from(userRoles)
          .where(
            and(
              eq(userRoles.userId, user.id),
              eq(userRoles.roleId, roleId),
            ),
          )
          .limit(1);

      if (existingAssignment.length === 0) {
        await tx
          .insert(userRoles)
          .values({
            userId: user.id,
            roleId,
          });
      }
    }
  });

  console.log(
    'Seed completed successfully.',
  );

  console.log(
    `Test user password: ${testPassword}`,
  );
};

seed().catch((error) => {
  console.error('Seed failed:', error);
  process.exitCode = 1;
});