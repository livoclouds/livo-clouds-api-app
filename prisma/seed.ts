import { PrismaClient, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();
const SALT_ROUNDS = 12;

async function main() {
  console.log('🌱 Seeding database...');

  // ─── Condominiums ────────────────────────────────────────────

  const cotoalameda = await prisma.condominium.upsert({
    where: { slug: 'cotoalameda' },
    update: {},
    create: {
      slug: 'cotoalameda',
      name: 'Coto La Alameda 1511',
      primaryColor: '#6366f1',
      isActive: true,
      settings: {
        create: {
          timezone: 'America/Monterrey',
          currency: 'MXN',
          country: 'MX',
          defaultLocale: 'es',
          totalUnits: 50,
          ordinaryFeeAmount: 2400,
          ordinaryPaymentDayStart: 1,
          ordinaryPaymentDayEnd: 10,
          lateFeeAmount: 200,
          lateFeeStartDay: 11,
          paymentFrequency: 'monthly',
        },
      },
    },
  });

  const cotolospatos = await prisma.condominium.upsert({
    where: { slug: 'cotolospatos' },
    update: {},
    create: {
      slug: 'cotolospatos',
      name: 'Coto Los Patos',
      primaryColor: '#10b981',
      isActive: true,
      settings: {
        create: {
          timezone: 'America/Monterrey',
          currency: 'MXN',
          country: 'MX',
          defaultLocale: 'es',
          totalUnits: 30,
          ordinaryFeeAmount: 1800,
          ordinaryPaymentDayStart: 1,
          ordinaryPaymentDayEnd: 10,
          lateFeeAmount: 150,
          lateFeeStartDay: 11,
          paymentFrequency: 'monthly',
        },
      },
    },
  });

  console.log(`✅ Condominiums: ${cotoalameda.slug}, ${cotolospatos.slug}`);

  // ─── Users ───────────────────────────────────────────────────

  const users = [
    {
      email: 'root@demo.com',
      password: 'Root1234!',
      role: UserRole.ROOT,
      firstName: 'Admin',
      lastName: 'Root',
      condominiumId: null,
    },
    {
      email: 'admin@cotoalameda.com',
      password: 'Admin1234!',
      role: UserRole.TENANT_ADMIN,
      firstName: 'Carlos',
      lastName: 'Mendoza',
      condominiumId: cotoalameda.id,
    },
    {
      email: 'view@cotoalameda.com',
      password: 'View1234!',
      role: UserRole.READ_ONLY,
      firstName: 'Ana',
      lastName: 'Torres',
      condominiumId: cotoalameda.id,
    },
    {
      email: 'guard@cotoalameda.com',
      password: 'Guard1234!',
      role: UserRole.GUARD,
      firstName: 'Roberto',
      lastName: 'Flores',
      condominiumId: cotoalameda.id,
    },
    {
      email: 'admin@cotolospatos.com',
      password: 'Admin1234!',
      role: UserRole.TENANT_ADMIN,
      firstName: 'Laura',
      lastName: 'Ramirez',
      condominiumId: cotolospatos.id,
    },
    {
      email: 'view@cotolospatos.com',
      password: 'View1234!',
      role: UserRole.READ_ONLY,
      firstName: 'Miguel',
      lastName: 'Herrera',
      condominiumId: cotolospatos.id,
    },
  ];

  const createdUsers: Record<string, string> = {};

  for (const u of users) {
    const passwordHash = await bcrypt.hash(u.password, SALT_ROUNDS);
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: {
        email: u.email,
        passwordHash,
        role: u.role,
        firstName: u.firstName,
        lastName: u.lastName,
        condominiumId: u.condominiumId,
        isActive: true,
      },
    });
    createdUsers[u.email] = user.id;
  }

  console.log(`✅ Users created: ${Object.keys(createdUsers).length}`);

  const adminId = createdUsers['admin@cotoalameda.com'];
  const adminPatos = createdUsers['admin@cotolospatos.com'];

  // ─── Residents (Coto La Alameda) ─────────────────────────────

  const residentData = [
    { unitNumber: 'A01', firstName: 'Juan', lastName: 'García', paymentStatus: 'CURRENT' as const, debt: 0, monthlyFee: 2400 },
    { unitNumber: 'A02', firstName: 'María', lastName: 'López', paymentStatus: 'OVERDUE' as const, debt: 4800, monthlyFee: 2400 },
    { unitNumber: 'A03', firstName: 'Pedro', lastName: 'Martínez', paymentStatus: 'CURRENT' as const, debt: 0, monthlyFee: 2400 },
    { unitNumber: 'B01', firstName: 'Elena', lastName: 'Rodríguez', paymentStatus: 'CURRENT' as const, debt: 0, monthlyFee: 2400 },
    { unitNumber: 'B02', firstName: 'Luis', lastName: 'Sánchez', paymentStatus: 'OVERDUE' as const, debt: 2400, monthlyFee: 2400 },
  ];

  for (const r of residentData) {
    await prisma.resident.upsert({
      where: { condominiumId_unitNumber: { condominiumId: cotoalameda.id, unitNumber: r.unitNumber } },
      update: {},
      create: {
        condominiumId: cotoalameda.id,
        unitNumber: r.unitNumber,
        firstName: r.firstName,
        lastName: r.lastName,
        residentType: 'OWNER',
        paymentStatus: r.paymentStatus,
        debt: r.debt,
        monthlyFee: r.monthlyFee,
        parkingSpots: 1,
      },
    });
  }

  console.log(`✅ Residents seeded for ${cotoalameda.slug}`);

  // ─── Common Areas (Coto La Alameda) ──────────────────────────

  const areas = [
    { name: 'Administration Office', status: 'ACTIVE' as const },
    { name: 'Gym', status: 'ACTIVE' as const },
    { name: 'Pool Area', status: 'ACTIVE' as const },
    { name: 'Rooftop Terrace', status: 'ACTIVE' as const },
    { name: 'Security Booth', status: 'ACTIVE' as const },
    { name: 'Parking Lobby', status: 'ACTIVE' as const },
  ];

  const createdAreas: string[] = [];

  for (const area of areas) {
    const created = await prisma.commonArea.create({
      data: { condominiumId: cotoalameda.id, ...area },
    });
    createdAreas.push(created.id);
  }

  console.log(`✅ Common areas seeded: ${areas.length}`);

  // ─── Inventory Items ──────────────────────────────────────────

  if (createdAreas.length > 0) {
    await prisma.inventoryItem.createMany({
      data: [
        {
          condominiumId: cotoalameda.id,
          commonAreaId: createdAreas[0],
          name: 'Desktop Computer',
          category: 'ELECTRONICS',
          brand: 'HP',
          quantity: 2,
          condition: 'GOOD',
          approximateCost: 15000,
          hasInvoice: true,
        },
        {
          condominiumId: cotoalameda.id,
          commonAreaId: createdAreas[1],
          name: 'Treadmill',
          category: 'APPLIANCES',
          brand: 'ProForm',
          quantity: 3,
          condition: 'GOOD',
          approximateCost: 12000,
          hasInvoice: true,
        },
        {
          condominiumId: cotoalameda.id,
          commonAreaId: createdAreas[2],
          name: 'Pool Pump',
          category: 'TOOLS',
          brand: 'Pentair',
          quantity: 1,
          condition: 'GOOD',
          approximateCost: 8500,
          hasInvoice: true,
        },
      ],
    });
    console.log('✅ Inventory items seeded');
  }

  // ─── Petty Cash Movements ─────────────────────────────────────

  await prisma.pettyCashMovement.createMany({
    data: [
      {
        condominiumId: cotoalameda.id,
        folio: 'PC-0001',
        date: new Date('2026-01-10'),
        movementType: 'ENTRY',
        category: 'OTHER',
        concept: 'Initial petty cash fund',
        amount: 5000,
        runningBalance: 5000,
        status: 'APPROVED',
        deliveryMethod: 'CASH',
        responsible: 'Carlos Mendoza',
        hasReceipt: false,
        registeredById: adminId,
      },
      {
        condominiumId: cotoalameda.id,
        folio: 'PC-0002',
        date: new Date('2026-01-15'),
        movementType: 'EXIT',
        category: 'CLEANING',
        concept: 'Cleaning supplies',
        amount: 450,
        runningBalance: 4550,
        status: 'APPROVED',
        deliveryMethod: 'CASH',
        responsible: 'Ana Torres',
        supplier: 'Supplier XYZ',
        hasReceipt: true,
        receiptNumber: 'REC-001',
        authorizedBy: 'Carlos Mendoza',
        registeredById: adminId,
      },
      {
        condominiumId: cotoalameda.id,
        folio: 'PC-0003',
        date: new Date('2026-01-20'),
        movementType: 'EXIT',
        category: 'MAINTENANCE',
        concept: 'Light bulb replacements',
        amount: 320,
        runningBalance: 4230,
        status: 'PENDING',
        deliveryMethod: 'CASH',
        responsible: 'Roberto Flores',
        hasReceipt: true,
        receiptNumber: 'REC-002',
        registeredById: adminId,
      },
    ],
  });

  console.log('✅ Petty cash movements seeded');

  // ─── Audit Logs ───────────────────────────────────────────────

  await prisma.auditLog.createMany({
    data: [
      {
        condominiumId: cotoalameda.id,
        userId: adminId,
        action: 'USER_LOGGED_IN',
        actionCategory: 'Authentication',
        module: 'auth',
        result: 'SUCCESS',
        description: 'User logged in successfully',
        ipAddress: '192.168.1.1',
      },
      {
        condominiumId: cotoalameda.id,
        userId: adminId,
        action: 'SETTINGS_UPDATED',
        actionCategory: 'Configuration',
        module: 'settings',
        result: 'SUCCESS',
        description: 'General settings updated',
      },
    ],
  });

  console.log('✅ Audit logs seeded');
  console.log('\n✨ Seed completed successfully!');
  console.log('\n📋 Test accounts:');
  console.log('   root@demo.com         / Root1234!   (ROOT)');
  console.log('   admin@cotoalameda.com / Admin1234!  (TENANT_ADMIN)');
  console.log('   view@cotoalameda.com  / View1234!   (READ_ONLY)');
  console.log('   guard@cotoalameda.com / Guard1234!  (GUARD)');
  console.log('   admin@cotolospatos.com / Admin1234! (TENANT_ADMIN)');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
