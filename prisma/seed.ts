import {
  PrismaClient,
  Prisma,
  ResidentType,
  PaymentStatus,
  CommonAreaStatus,
  InventoryCategory,
  InventoryCondition,
  MovementType,
  MovementCategory,
  MovementStatus,
  DeliveryMethod,
  AuditResult,
  EventType,
  EventStatus,
} from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import * as fs from 'fs';
import * as path from 'path';
import { SYSTEM_ROLES } from '../src/common/rbac/permission-catalog';

const prisma = new PrismaClient();
const SALT_ROUNDS = 12;

// ─── Condominium definitions ──────────────────────────────────────────────────

const CONDO_DEFINITIONS = [
  {
    slug: 'cotoalameda',
    name: 'Coto La Alameda 1511',
    legalName: 'Asociación de Condóminos La Alameda A.C.',
    primaryColor: '#6366f1',
    settings: {
      address: 'Av. La Alameda 1511, Col. Del Valle, Monterrey, N.L. 64300',
      adminPhone: '+52 81 8356 1200',
      contactEmail: 'contacto@cotoalameda.com',
      businessHours: { weekdays: '9:00 AM - 6:00 PM', saturday: '9:00 AM - 2:00 PM', sunday: 'Closed' },
      timezone: 'America/Monterrey', currency: 'MXN', country: 'MX', defaultLocale: 'es',
      totalUnits: 370, ordinaryFeeAmount: 500, lateFeeAmount: 100,
      ordinaryPaymentDayStart: 1, ordinaryPaymentDayEnd: 10, lateFeeStartDay: 11, paymentFrequency: 'monthly',
    },
  },
  {
    slug: 'cotolospatos',
    name: 'Coto Los Patos',
    legalName: 'Condominio Los Patos S.A. de C.V.',
    primaryColor: '#10b981',
    settings: {
      address: 'Circuito Los Patos 245, Col. Jardines, Guadalajara, Jal. 44500',
      adminPhone: '+52 33 3841 5600',
      contactEmail: 'admin@cotolospatos.com',
      businessHours: { weekdays: '8:00 AM - 5:00 PM', saturday: '9:00 AM - 1:00 PM', sunday: 'Closed' },
      timezone: 'America/Mexico_City', currency: 'MXN', country: 'MX', defaultLocale: 'es',
      totalUnits: 30, ordinaryFeeAmount: 1800, lateFeeAmount: 150,
      ordinaryPaymentDayStart: 1, ordinaryPaymentDayEnd: 10, lateFeeStartDay: 11, paymentFrequency: 'monthly',
    },
  },
  {
    slug: 'cotoencinos',
    name: 'Coto Los Encinos',
    legalName: 'Asociación de Colonos Los Encinos A.C.',
    primaryColor: '#f59e0b',
    settings: {
      address: 'Blvd. Los Encinos 890, Fracc. Cumbres, San Pedro Garza García, N.L. 66220',
      adminPhone: '+52 81 8125 4400',
      contactEmail: 'info@cotoencinos.com',
      businessHours: { weekdays: '9:00 AM - 6:00 PM', saturday: '10:00 AM - 2:00 PM', sunday: 'Closed' },
      timezone: 'America/Monterrey', currency: 'MXN', country: 'MX', defaultLocale: 'es',
      totalUnits: 40, ordinaryFeeAmount: 2200, lateFeeAmount: 180,
      ordinaryPaymentDayStart: 1, ordinaryPaymentDayEnd: 10, lateFeeStartDay: 11, paymentFrequency: 'monthly',
    },
  },
  {
    slug: 'bosquesdellago',
    name: 'Residencial Bosques del Lago',
    legalName: 'Condominio Residencial Bosques del Lago S.C.',
    primaryColor: '#3b82f6',
    settings: {
      address: 'Lago Especular 320, Col. Bosques de las Lomas, CDMX 11700',
      adminPhone: '+52 55 5245 8800',
      contactEmail: 'administracion@bosquesdellago.mx',
      businessHours: { weekdays: '8:30 AM - 6:30 PM', saturday: '9:00 AM - 3:00 PM', sunday: '10:00 AM - 1:00 PM' },
      timezone: 'America/Mexico_City', currency: 'MXN', country: 'MX', defaultLocale: 'es',
      totalUnits: 60, ordinaryFeeAmount: 3000, lateFeeAmount: 250,
      ordinaryPaymentDayStart: 1, ordinaryPaymentDayEnd: 10, lateFeeStartDay: 11, paymentFrequency: 'monthly',
    },
  },
  {
    slug: 'cotovalledorado',
    name: 'Coto Valle Dorado',
    legalName: 'Asociación de Condóminos Valle Dorado A.C.',
    primaryColor: '#eab308',
    settings: {
      address: 'Paseo Valle Dorado 1100, Fracc. Real del Valle, Tlajomulco, Jal. 45640',
      adminPhone: '+52 33 3680 2200',
      contactEmail: 'coto@valledorado.com',
      businessHours: { weekdays: '9:00 AM - 5:30 PM', saturday: '9:00 AM - 12:00 PM', sunday: 'Closed' },
      timezone: 'America/Mexico_City', currency: 'MXN', country: 'MX', defaultLocale: 'es',
      totalUnits: 45, ordinaryFeeAmount: 2800, lateFeeAmount: 220,
      ordinaryPaymentDayStart: 1, ordinaryPaymentDayEnd: 10, lateFeeStartDay: 11, paymentFrequency: 'monthly',
    },
  },
  {
    slug: 'vistaroble',
    name: 'Residencial Vista Roble',
    legalName: 'Condominio Residencial Vista Roble A.C.',
    primaryColor: '#84cc16',
    settings: {
      address: 'Av. Vista Roble 55, Col. Arboles, Querétaro, Qro. 76230',
      adminPhone: '+52 442 215 7700',
      contactEmail: 'vistaroble@administracion.mx',
      businessHours: { weekdays: '9:00 AM - 6:00 PM', saturday: '9:00 AM - 1:00 PM', sunday: 'Closed' },
      timezone: 'America/Mexico_City', currency: 'MXN', country: 'MX', defaultLocale: 'es',
      totalUnits: 25, ordinaryFeeAmount: 1500, lateFeeAmount: 120,
      ordinaryPaymentDayStart: 1, ordinaryPaymentDayEnd: 10, lateFeeStartDay: 11, paymentFrequency: 'monthly',
    },
  },
  {
    slug: 'puertadelsol',
    name: 'Coto Puerta del Sol',
    legalName: 'Asociación de Colonos Puerta del Sol A.C.',
    primaryColor: '#f97316',
    settings: {
      address: 'Blvd. Puerta del Sol 3400, Fracc. Real del Sol, Zapopan, Jal. 45054',
      adminPhone: '+52 33 3777 9900',
      contactEmail: 'puertadelsol@gmail.com',
      businessHours: { weekdays: '8:00 AM - 7:00 PM', saturday: '9:00 AM - 4:00 PM', sunday: '10:00 AM - 2:00 PM' },
      timezone: 'America/Mexico_City', currency: 'MXN', country: 'MX', defaultLocale: 'es',
      totalUnits: 80, ordinaryFeeAmount: 3500, lateFeeAmount: 300,
      ordinaryPaymentDayStart: 1, ordinaryPaymentDayEnd: 10, lateFeeStartDay: 11, paymentFrequency: 'monthly',
    },
  },
  {
    slug: 'jardinesdelvalley',
    name: 'Condominio Jardines del Valle',
    legalName: 'Condominio Jardines del Valle S.C.',
    primaryColor: '#06b6d4',
    settings: {
      address: 'Calle Valle Florido 200, Col. Jardines del Valle, Monterrey, N.L. 64985',
      adminPhone: '+52 81 8421 3300',
      contactEmail: 'admin@jardinesdelvalley.mx',
      businessHours: { weekdays: '9:00 AM - 6:00 PM', saturday: '9:00 AM - 2:00 PM', sunday: 'Closed' },
      timezone: 'America/Monterrey', currency: 'MXN', country: 'MX', defaultLocale: 'es',
      totalUnits: 55, ordinaryFeeAmount: 2600, lateFeeAmount: 200,
      ordinaryPaymentDayStart: 1, ordinaryPaymentDayEnd: 10, lateFeeStartDay: 11, paymentFrequency: 'monthly',
    },
  },
  {
    slug: 'altosdelparque',
    name: 'Residencial Altos del Parque',
    legalName: 'Condominio Residencial Altos del Parque S.A.',
    primaryColor: '#8b5cf6',
    settings: {
      address: 'Av. del Parque 780, Col. Altos, Puebla, Pue. 72830',
      adminPhone: '+52 222 245 1100',
      contactEmail: 'altosdelparque@admin.com',
      businessHours: { weekdays: '9:00 AM - 5:00 PM', saturday: '10:00 AM - 1:00 PM', sunday: 'Closed' },
      timezone: 'America/Mexico_City', currency: 'MXN', country: 'MX', defaultLocale: 'es',
      totalUnits: 35, ordinaryFeeAmount: 2000, lateFeeAmount: 160,
      ordinaryPaymentDayStart: 1, ordinaryPaymentDayEnd: 10, lateFeeStartDay: 11, paymentFrequency: 'monthly',
    },
  },
  {
    slug: 'senderosdelsbosque',
    name: 'Coto Senderos del Bosque',
    legalName: 'Asociación de Condóminos Senderos del Bosque A.C.',
    primaryColor: '#ec4899',
    settings: {
      address: 'Sendero Forestal 95, Fracc. Bosque Real, León, Gto. 37510',
      adminPhone: '+52 477 718 4400',
      contactEmail: 'senderos@bosque.mx',
      businessHours: { weekdays: '9:00 AM - 6:00 PM', saturday: '9:00 AM - 2:00 PM', sunday: 'Closed' },
      timezone: 'America/Mexico_City', currency: 'MXN', country: 'MX', defaultLocale: 'es',
      totalUnits: 28, ordinaryFeeAmount: 1900, lateFeeAmount: 150,
      ordinaryPaymentDayStart: 1, ordinaryPaymentDayEnd: 10, lateFeeStartDay: 11, paymentFrequency: 'monthly',
    },
  },
];

// ─── Common area templates ────────────────────────────────────────────────────

const AREAS_SECURITY = [
  {
    name: 'Caseta de Seguridad',
    description: 'Punto de control de acceso principal con vigilancia 24/7 y registro de visitas.',
    physicalLocation: 'Entrada principal del condominio',
    status: 'ACTIVE' as CommonAreaStatus,
    responsiblePerson: 'Coordinador de Seguridad',
  },
  {
    name: 'Oficina de Administración',
    description: 'Oficina principal de administración y atención a condóminos.',
    physicalLocation: 'Planta baja, edificio central',
    status: 'ACTIVE' as CommonAreaStatus,
    responsiblePerson: 'Administrador General',
  },
  {
    name: 'Estacionamiento de Visitas',
    description: 'Área de estacionamiento exclusiva para visitantes con capacidad para 20 vehículos.',
    physicalLocation: 'Costado derecho de la entrada principal',
    status: 'ACTIVE' as CommonAreaStatus,
    responsiblePerson: 'Guardia de turno',
  },
  {
    name: 'Bodega General',
    description: 'Almacén para equipos, herramientas y materiales de mantenimiento del condominio.',
    physicalLocation: 'Zona posterior, junto al área técnica',
    status: 'ACTIVE' as CommonAreaStatus,
    responsiblePerson: 'Encargado de Mantenimiento',
  },
  {
    name: 'Área de Contenedores',
    description: 'Zona designada para contenedores de reciclaje y residuos sólidos.',
    physicalLocation: 'Lateral izquierdo, acceso por calle interna',
    status: 'MAINTENANCE' as CommonAreaStatus,
    responsiblePerson: 'Personal de limpieza',
  },
];

const AREAS_AMENITIES = [
  {
    name: 'Salón de Eventos',
    description: 'Salón multiusos para eventos sociales, reuniones de condóminos y celebraciones privadas con capacidad para 80 personas.',
    physicalLocation: 'Edificio de amenidades, planta baja',
    status: 'ACTIVE' as CommonAreaStatus,
    responsiblePerson: 'Coordinadora de Eventos',
  },
  {
    name: 'Alberca',
    description: 'Alberca semiolímpica con área de descanso, regaderas y vestidores. Horario de uso 7:00 AM a 9:00 PM.',
    physicalLocation: 'Área central del condominio, junto a jardines',
    status: 'ACTIVE' as CommonAreaStatus,
    responsiblePerson: 'Salvavidas certificado',
  },
  {
    name: 'Gimnasio',
    description: 'Gimnasio equipado con máquinas cardiovasculares, zona de pesas y área de estiramiento.',
    physicalLocation: 'Edificio de amenidades, segundo piso',
    status: 'ACTIVE' as CommonAreaStatus,
    responsiblePerson: 'Instructor de fitness',
  },
  {
    name: 'Jardines Comunes',
    description: 'Áreas verdes con senderos, bancas y zona de juegos infantiles para uso de los residentes.',
    physicalLocation: 'Distribuidos en el perímetro interior del condominio',
    status: 'ACTIVE' as CommonAreaStatus,
    responsiblePerson: 'Jardinero principal',
  },
  {
    name: 'Área de Asadores',
    description: 'Zona de esparcimiento al aire libre con asadores fijos, mesas y área para niños.',
    physicalLocation: 'Zona norte, colindante con jardines',
    status: 'ACTIVE' as CommonAreaStatus,
    responsiblePerson: 'Administrador General',
  },
];

// ─── Inventory item templates per area type ───────────────────────────────────

function buildInventoryItems(
  condominiumId: string,
  areaIds: string[],
  prefix: string,
  isSecurityType: boolean,
) {
  if (isSecurityType) {
    // areaIds: [caseta, oficina, estacionamiento, bodega, contenedores]
    return [
      { condominiumId, commonAreaId: areaIds[0], name: 'Cámara IP Domo', category: 'SECURITY' as InventoryCategory, brand: 'Hikvision', model: 'DS-2CD2143G2-I', serialNumber: `${prefix}-CAM-001`, quantity: 4, condition: 'GOOD' as InventoryCondition, purchaseDate: new Date('2024-03-15'), approximateCost: 3200, supplier: 'TechSec México', hasInvoice: true, invoiceNumber: `INV-${prefix}-001`, notes: 'Cámaras de 4MP con visión nocturna instaladas en perímetro' },
      { condominiumId, commonAreaId: areaIds[0], name: 'Radio Portátil', category: 'COMMUNICATIONS' as InventoryCategory, brand: 'Motorola', model: 'XT660d', serialNumber: `${prefix}-RAD-001`, quantity: 3, condition: 'GOOD' as InventoryCondition, purchaseDate: new Date('2024-01-20'), approximateCost: 4500, supplier: 'Comunicaciones Integrales', hasInvoice: true, invoiceNumber: `INV-${prefix}-002`, notes: 'Con cargador triple y baterías de respaldo' },
      { condominiumId, commonAreaId: areaIds[0], name: 'Control de Acceso Biométrico', category: 'SECURITY' as InventoryCategory, brand: 'ZKTeco', model: 'SpeedFace-V5L', serialNumber: `${prefix}-ACC-001`, quantity: 1, condition: 'GOOD' as InventoryCondition, purchaseDate: new Date('2024-06-01'), approximateCost: 8500, supplier: 'TechSec México', hasInvoice: true, invoiceNumber: `INV-${prefix}-003`, notes: 'Reconocimiento facial y tarjeta RFID' },
      { condominiumId, commonAreaId: areaIds[1], name: 'Laptop Administrativa', category: 'ELECTRONICS' as InventoryCategory, brand: 'HP', model: 'ProBook 450 G10', serialNumber: `${prefix}-LAP-001`, quantity: 1, condition: 'GOOD' as InventoryCondition, purchaseDate: new Date('2023-11-10'), approximateCost: 18000, supplier: 'Office Depot México', hasInvoice: true, invoiceNumber: `INV-${prefix}-004`, notes: 'Core i5, 16GB RAM, 512GB SSD' },
      { condominiumId, commonAreaId: areaIds[1], name: 'Impresora Multifuncional', category: 'OFFICE' as InventoryCategory, brand: 'Epson', model: 'EcoTank ET-4850', serialNumber: `${prefix}-IMP-001`, quantity: 1, condition: 'GOOD' as InventoryCondition, purchaseDate: new Date('2023-11-10'), approximateCost: 9500, supplier: 'Office Depot México', hasInvoice: true, invoiceNumber: `INV-${prefix}-005`, notes: 'Impresión, copia, escaneo y fax' },
      { condominiumId, commonAreaId: areaIds[1], name: 'Escritorio Ejecutivo', category: 'FURNITURE' as InventoryCategory, brand: 'Ofisillas', model: 'Modelo Gerente 160', serialNumber: `${prefix}-ESC-001`, quantity: 1, condition: 'GOOD' as InventoryCondition, purchaseDate: new Date('2022-08-05'), approximateCost: 6800, supplier: 'Ofisillas Monterrey', hasInvoice: false, invoiceNumber: null, notes: 'Incluye sillón ejecutivo y credenza' },
      { condominiumId, commonAreaId: areaIds[2], name: 'Señalética Vial', category: 'SAFETY' as InventoryCategory, brand: 'Tresgres', model: 'SV-Aluminio', serialNumber: `${prefix}-SEN-001`, quantity: 8, condition: 'GOOD' as InventoryCondition, purchaseDate: new Date('2023-02-14'), approximateCost: 650, supplier: 'Seguridad Industrial del Norte', hasInvoice: true, invoiceNumber: `INV-${prefix}-006`, notes: 'Señales de ALTO, velocidad máxima y prohibido' },
      { condominiumId, commonAreaId: areaIds[2], name: 'Cono de Tráfico', category: 'SAFETY' as InventoryCategory, brand: 'Genérico', model: 'CT-70cm', serialNumber: `${prefix}-CON-001`, quantity: 20, condition: 'FAIR' as InventoryCondition, purchaseDate: new Date('2022-05-20'), approximateCost: 180, supplier: 'Ferremat', hasInvoice: false, invoiceNumber: null, notes: 'Uso en maniobras y eventos' },
      { condominiumId, commonAreaId: areaIds[3], name: 'Cortadora de Césped', category: 'TOOLS' as InventoryCategory, brand: 'Husqvarna', model: 'LC 347V', serialNumber: `${prefix}-CES-001`, quantity: 1, condition: 'GOOD' as InventoryCondition, purchaseDate: new Date('2023-04-10'), approximateCost: 12000, supplier: 'Jardinerías del Norte', hasInvoice: true, invoiceNumber: `INV-${prefix}-007`, notes: 'Autopropulsada, 47 cm de corte' },
      { condominiumId, commonAreaId: areaIds[3], name: 'Extintor PQS 9 kg', category: 'SAFETY' as InventoryCategory, brand: 'Amerex', model: 'B441', serialNumber: `${prefix}-EXT-001`, quantity: 6, condition: 'GOOD' as InventoryCondition, purchaseDate: new Date('2024-01-05'), approximateCost: 1200, supplier: 'Sistemas Contra Incendios S.A.', hasInvoice: true, invoiceNumber: `INV-${prefix}-008`, notes: 'Mantenimiento anual programado para enero 2026' },
      { condominiumId, commonAreaId: areaIds[3], name: 'Hidrolavadora', category: 'TOOLS' as InventoryCategory, brand: 'Kärcher', model: 'K5 Premium', serialNumber: `${prefix}-HID-001`, quantity: 1, condition: 'GOOD' as InventoryCondition, purchaseDate: new Date('2023-07-18'), approximateCost: 8900, supplier: 'Ferremat', hasInvoice: true, invoiceNumber: `INV-${prefix}-009`, notes: '145 bar, accesorios completos' },
      { condominiumId, commonAreaId: areaIds[3], name: 'UPS para Servidores', category: 'ELECTRONICS' as InventoryCategory, brand: 'APC', model: 'Smart-UPS 1000VA', serialNumber: `${prefix}-UPS-001`, quantity: 2, condition: 'GOOD' as InventoryCondition, purchaseDate: new Date('2023-09-01'), approximateCost: 7500, supplier: 'TechSec México', hasInvoice: true, invoiceNumber: `INV-${prefix}-010`, notes: 'Para respaldo de equipos de seguridad y red' },
    ];
  } else {
    // areaIds: [salon, alberca, gimnasio, jardines, asadores]
    return [
      { condominiumId, commonAreaId: areaIds[0], name: 'Sistema de Sonido Profesional', category: 'ELECTRONICS' as InventoryCategory, brand: 'Bose', model: 'FreeSpace DS 40F', serialNumber: `${prefix}-SND-001`, quantity: 1, condition: 'GOOD' as InventoryCondition, purchaseDate: new Date('2023-12-01'), approximateCost: 22000, supplier: 'Audio Pro México', hasInvoice: true, invoiceNumber: `INV-${prefix}-001`, notes: 'Con amplificador, mezclador y 8 bocinas empotradas' },
      { condominiumId, commonAreaId: areaIds[0], name: 'Mesa Plegable 6 personas', category: 'FURNITURE' as InventoryCategory, brand: 'Ofisillas', model: 'MF-180', serialNumber: `${prefix}-MES-001`, quantity: 15, condition: 'GOOD' as InventoryCondition, purchaseDate: new Date('2022-06-15'), approximateCost: 2200, supplier: 'Ofisillas Monterrey', hasInvoice: true, invoiceNumber: `INV-${prefix}-002`, notes: 'Aluminio plegable, tapizadas en negro' },
      { condominiumId, commonAreaId: areaIds[0], name: 'Silla Plegable', category: 'FURNITURE' as InventoryCategory, brand: 'Ofisillas', model: 'SF-Básica', serialNumber: `${prefix}-SIL-001`, quantity: 80, condition: 'GOOD' as InventoryCondition, purchaseDate: new Date('2022-06-15'), approximateCost: 420, supplier: 'Ofisillas Monterrey', hasInvoice: true, invoiceNumber: `INV-${prefix}-003`, notes: 'Almacenadas en rack de metal' },
      { condominiumId, commonAreaId: areaIds[1], name: 'Bomba de Alberca', category: 'APPLIANCES' as InventoryCategory, brand: 'Pentair', model: 'SuperFlo VS', serialNumber: `${prefix}-BOM-001`, quantity: 1, condition: 'GOOD' as InventoryCondition, purchaseDate: new Date('2023-05-20'), approximateCost: 18500, supplier: 'Albercas del Pacífico', hasInvoice: true, invoiceNumber: `INV-${prefix}-004`, notes: 'Bomba de velocidad variable, 1.5 HP' },
      { condominiumId, commonAreaId: areaIds[1], name: 'Kit de Limpieza de Alberca', category: 'CLEANING' as InventoryCategory, brand: 'Hayward', model: 'TigerShark QC', serialNumber: `${prefix}-KIT-001`, quantity: 1, condition: 'GOOD' as InventoryCondition, purchaseDate: new Date('2023-05-20'), approximateCost: 6500, supplier: 'Albercas del Pacífico', hasInvoice: true, invoiceNumber: `INV-${prefix}-005`, notes: 'Robot limpiador automático de piso y paredes' },
      { condominiumId, commonAreaId: areaIds[2], name: 'Caminadora Eléctrica', category: 'APPLIANCES' as InventoryCategory, brand: 'ProForm', model: 'Pro 2000', serialNumber: `${prefix}-CAM-001`, quantity: 3, condition: 'GOOD' as InventoryCondition, purchaseDate: new Date('2023-01-10'), approximateCost: 14000, supplier: 'Sportland México', hasInvoice: true, invoiceNumber: `INV-${prefix}-006`, notes: 'Con pantalla HD y conectividad iFit' },
      { condominiumId, commonAreaId: areaIds[2], name: 'Bicicleta Estacionaria', category: 'APPLIANCES' as InventoryCategory, brand: 'NordicTrack', model: 'Commercial S22i', serialNumber: `${prefix}-BIC-001`, quantity: 2, condition: 'GOOD' as InventoryCondition, purchaseDate: new Date('2023-01-10'), approximateCost: 12000, supplier: 'Sportland México', hasInvoice: true, invoiceNumber: `INV-${prefix}-007`, notes: 'Con inclinación y declive motorizado' },
      { condominiumId, commonAreaId: areaIds[2], name: 'Juego de Mancuernas', category: 'APPLIANCES' as InventoryCategory, brand: 'Cap Barbell', model: 'SDBS-20', serialNumber: `${prefix}-MAN-001`, quantity: 1, condition: 'GOOD' as InventoryCondition, purchaseDate: new Date('2023-01-10'), approximateCost: 9500, supplier: 'Sportland México', hasInvoice: true, invoiceNumber: `INV-${prefix}-008`, notes: 'Set completo 2kg - 20kg con rack' },
      { condominiumId, commonAreaId: areaIds[3], name: 'Banca de Jardín', category: 'FURNITURE' as InventoryCategory, brand: 'Eternit', model: 'BJ-150', serialNumber: `${prefix}-BAN-001`, quantity: 12, condition: 'GOOD' as InventoryCondition, purchaseDate: new Date('2022-03-01'), approximateCost: 1800, supplier: 'Jardinería y Más', hasInvoice: false, invoiceNumber: null, notes: 'Fibrocemento, resistente a la intemperie' },
      { condominiumId, commonAreaId: areaIds[3], name: 'Luminaria LED Solar', category: 'ELECTRONICS' as InventoryCategory, brand: 'Philips', model: 'BGP302 LED', serialNumber: `${prefix}-LUM-001`, quantity: 18, condition: 'GOOD' as InventoryCondition, purchaseDate: new Date('2023-08-15'), approximateCost: 3200, supplier: 'Iluminación Total', hasInvoice: true, invoiceNumber: `INV-${prefix}-009`, notes: 'Instaladas en senderos y áreas de acceso' },
      { condominiumId, commonAreaId: areaIds[4], name: 'Asador Fijo de Gas', category: 'APPLIANCES' as InventoryCategory, brand: 'Weber', model: 'Summit E-470', serialNumber: `${prefix}-ASA-001`, quantity: 3, condition: 'GOOD' as InventoryCondition, purchaseDate: new Date('2022-12-10'), approximateCost: 28000, supplier: 'Casa Weber México', hasInvoice: true, invoiceNumber: `INV-${prefix}-010`, notes: 'Con cubierta de acero, requiere mantenimiento semestral' },
      { condominiumId, commonAreaId: areaIds[4], name: 'Extintor CO2 5 kg', category: 'SAFETY' as InventoryCategory, brand: 'Amerex', model: 'B350T', serialNumber: `${prefix}-EXT-001`, quantity: 4, condition: 'GOOD' as InventoryCondition, purchaseDate: new Date('2024-01-05'), approximateCost: 1800, supplier: 'Sistemas Contra Incendios S.A.', hasInvoice: true, invoiceNumber: `INV-${prefix}-011`, notes: 'Para área de asadores y cocinas exteriores' },
    ];
  }
}

// ─── Resident name pool ───────────────────────────────────────────────────────

const FIRST_NAMES = ['Juan', 'María', 'Pedro', 'Elena', 'Luis', 'Carlos', 'Ana', 'Roberto', 'Laura', 'Miguel', 'Sofía', 'Diego', 'Isabel', 'Fernando', 'Valeria', 'Ricardo', 'Patricia', 'Antonio', 'Mónica', 'Javier', 'Claudia', 'Ernesto', 'Daniela', 'Héctor', 'Gabriela'];
const LAST_NAMES = ['García', 'López', 'Martínez', 'Rodríguez', 'Sánchez', 'Pérez', 'González', 'Hernández', 'Jiménez', 'Torres', 'Flores', 'Ruiz', 'Díaz', 'Moreno', 'Álvarez', 'Romero', 'Castro', 'Ortiz', 'Ramos', 'Vargas', 'Reyes', 'Mendoza', 'Guerrero', 'Medina', 'Aguilar'];

const RESIDENT_TYPES: ResidentType[] = ['OWNER', 'OWNER', 'OWNER', 'TENANT', 'CO_OWNER'];
const PAYMENT_STATUSES: PaymentStatus[] = ['CURRENT', 'CURRENT', 'CURRENT', 'OVERDUE', 'OVERDUE'];

function nameAt(pool: string[], condoIdx: number, unitIdx: number) {
  return pool[(condoIdx * 5 + unitIdx) % pool.length];
}

// ─── CSV resident helpers ─────────────────────────────────────────────────────

interface CsvResident {
  nombre: string;
  perfil: string;
  tipoUsuario: string;
  unidad: string;
  email: string;
  telefono: string;
  celular: string;
}

function parseResidentsCsv(filePath: string): CsvResident[] {
  const content = fs.readFileSync(filePath, 'utf-8').replace(/^﻿/, '').replace(/\r/g, '');
  const lines = content.split('\n').filter((l) => l.trim());
  return lines.slice(1).map((line) => {
    const cols = line.split(',');
    return {
      nombre:      cols[0]?.trim() ?? '',
      perfil:      cols[1]?.trim() ?? '',
      tipoUsuario: cols[2]?.trim() ?? '',
      unidad:      cols[3]?.trim() ?? '',
      email:       cols[4]?.trim() ?? '',
      telefono:    cols[5]?.trim() ?? '',
      celular:     cols[6]?.trim() ?? '',
    };
  }).filter((r) => r.unidad && r.nombre);
}

function splitName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

function csvResidentType(perfil: string): ResidentType {
  return perfil.toLowerCase().includes('residente') ? 'RESIDENT' : 'OWNER';
}

async function main() {
  // ─── Safety guard: refuse to wipe a production-like database ─────────────────
  // This seed is destructive (deleteMany across 20 models below) and is
  // DEVELOPMENT-ONLY. Production never runs the seed — it uses `migrate deploy`
  // only. See docs/database/.../reset-and-baseline-runbook.md (web repo).
  // Triggers on NODE_ENV=production or a prod-like DATABASE_URL; override with
  // ALLOW_DESTRUCTIVE_SEED=1 for the rare deliberate non-dev reseed.
  const databaseUrl = process.env.DATABASE_URL ?? '';
  const isProdLike =
    process.env.NODE_ENV === 'production' ||
    /\b(prod|production)\b/i.test(databaseUrl);
  if (isProdLike && process.env.ALLOW_DESTRUCTIVE_SEED !== '1') {
    // Note: intentionally does not echo DATABASE_URL (no secret leakage).
    throw new Error(
      'Refusing to run the destructive seed against a production-like environment. ' +
        'Set ALLOW_DESTRUCTIVE_SEED=1 to override (development only).',
    );
  }

  console.log('🌱 Seeding database...');

  // ─── Cleanup ───────────────────────────────────────────────────────────────
  console.log('🗑️  Cleaning existing data...');
  await prisma.notification.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.reconciliationCorrectionPattern.deleteMany();
  await prisma.paymentAllocation.deleteMany();
  await prisma.transaction.deleteMany();
  await prisma.reconciliationRule.deleteMany();
  await prisma.importBatch.deleteMany();
  await prisma.pettyCashMovement.deleteMany();
  await prisma.collectionRecord.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.inventoryItem.deleteMany();
  await prisma.commonArea.deleteMany();
  await prisma.calendarEvent.deleteMany();
  await prisma.vehicle.deleteMany();
  await prisma.pet.deleteMany();
  await prisma.additionalResident.deleteMany();
  await prisma.resident.deleteMany();
  await prisma.user.deleteMany();
  await prisma.role.deleteMany();
  await prisma.financialMonthlySummary.deleteMany();
  await prisma.condominiumSettings.deleteMany();
  await prisma.condominium.deleteMany();
  console.log('✅ Cleanup complete');

  // ─── Hash passwords ────────────────────────────────────────────────────────
  // DEV-ONLY demo credentials. These fixed passwords exist purely for local/demo
  // seed data. The production guard at the top of main() prevents this seed from
  // running in production, so they never become valid production credentials.
  const [hashRoot, hashAdmin, hashView, hashGuard, hashSupervisor, hashNeighbor] = await Promise.all([
    bcrypt.hash('Root1234!', SALT_ROUNDS),
    bcrypt.hash('Admin1234!', SALT_ROUNDS),
    bcrypt.hash('View1234!', SALT_ROUNDS),
    bcrypt.hash('Guard1234!', SALT_ROUNDS),
    bcrypt.hash('Supervisor1234!', SALT_ROUNDS),
    bcrypt.hash('Vecino1234!', SALT_ROUNDS),
  ]);

  // ─── Condominiums ──────────────────────────────────────────────────────────
  const condominiums: { id: string; slug: string; settings: { ordinaryFeeAmount: number } }[] = [];

  for (const def of CONDO_DEFINITIONS) {
    const { settings, ...rest } = def;
    const condo = await prisma.condominium.create({
      data: {
        ...rest,
        isActive: true,
        settings: {
          create: {
            timezone: settings.timezone,
            currency: settings.currency,
            country: settings.country,
            defaultLocale: settings.defaultLocale,
            address: settings.address,
            adminPhone: settings.adminPhone,
            contactEmail: settings.contactEmail,
            businessHours: settings.businessHours,
            totalUnits: settings.totalUnits,
            ordinaryFeeAmount: settings.ordinaryFeeAmount,
            lateFeeAmount: settings.lateFeeAmount,
            ordinaryPaymentDayStart: settings.ordinaryPaymentDayStart,
            ordinaryPaymentDayEnd: settings.ordinaryPaymentDayEnd,
            lateFeeStartDay: settings.lateFeeStartDay,
            paymentFrequency: settings.paymentFrequency,
          },
        },
      },
    });
    condominiums.push({ id: condo.id, slug: condo.slug, settings: { ordinaryFeeAmount: settings.ordinaryFeeAmount } });
  }
  console.log(`✅ Condominiums: ${condominiums.length}`);

  // ─── Bank Profiles (Default per condominium) ───────────────────────────────
  const DEFAULT_PROFILE_ALIASES = [
    {
      key: 'date', label: 'Fecha', system: true, required: true,
      aliases: ['fecha movimiento', 'fecha', 'date', 'fecha operación', 'fecha valor'],
    },
    {
      key: 'description', label: 'Descripción', system: true, required: true,
      aliases: ['descripción', 'descripcion', 'concepto', 'description'],
    },
    {
      key: 'charges', label: 'Cargos', system: true, required: true,
      aliases: ['cargos', 'cargo', 'débito', 'debito', 'charges', 'retiros'],
    },
    {
      key: 'credits', label: 'Abonos', system: true, required: true,
      aliases: ['abonos', 'abono', 'crédito', 'credito', 'credits', 'depósitos', 'depositos'],
    },
    {
      key: 'balance', label: 'Saldo', system: true, required: true,
      aliases: ['saldo', 'balance'],
    },
    {
      key: 'transactionNumber', label: 'Número', system: false, required: false,
      aliases: ['no.', 'núm.', 'número', 'num.', 'num', '#'],
    },
    {
      key: 'time', label: 'Hora', system: false, required: false,
      aliases: ['hora', 'hour', 'time'],
    },
    {
      key: 'receipt', label: 'Recibo', system: false, required: false,
      aliases: ['recibo', 'folio', 'receipt', 'referencia', 'ref'],
    },
  ];

  for (const condo of condominiums) {
    await prisma.bankProfile.create({
      data: {
        condominiumId: condo.id,
        name: 'Default',
        bankName: null,
        isDefault: true,
        isActive: true,
        useSameForPdf: true,
        excelAliases: DEFAULT_PROFILE_ALIASES,
        pdfAliases: [],
      },
    });
  }
  console.log(`✅ Bank profiles: ${condominiums.length} (one Default per condominium)`);

  // ─── Reconciliation Rules ──────────────────────────────────────────────────

  // Priorities are stored as a consecutive 1..N sequence per condominium,
  // ordered by their position in this seed array (no gaps).
  const baseRules = (condominiumId: string) => [
    {
      condominiumId,
      name: 'Cuota mensual de mantenimiento',
      keywords: ['mantenimiento', 'cuota mensual', 'mensualidad', 'mtto'],
      unitPatterns: [] as string[],
      conceptType: 'MAINTENANCE',
      confidenceThreshold: new Prisma.Decimal('0.85'),
      priority: 1,
      isActive: true,
    },
    {
      condominiumId,
      name: 'Pago de servicios',
      keywords: ['servicio', 'agua', 'luz', 'electricidad', 'gas'],
      unitPatterns: [] as string[],
      conceptType: 'UTILITY',
      confidenceThreshold: new Prisma.Decimal('0.80'),
      priority: 2,
      isActive: true,
    },
    {
      condominiumId,
      name: 'Cuota de estacionamiento',
      keywords: ['estacionamiento', 'cajón', 'parking'],
      unitPatterns: [] as string[],
      conceptType: 'PARKING',
      confidenceThreshold: new Prisma.Decimal('0.80'),
      priority: 3,
      isActive: true,
    },
  ];

  const rulesAlamedaId = condominiums.find((c) => c.slug === 'cotoalameda')!.id;
  const alamedaExtraRules = [
    {
      condominiumId: rulesAlamedaId,
      name: 'Depósito de seguridad',
      keywords: ['depósito', 'deposito', 'garantía', 'garantia'],
      unitPatterns: [] as string[],
      conceptType: 'DEPOSIT',
      confidenceThreshold: new Prisma.Decimal('0.85'),
      priority: 4,
      isActive: true,
    },
    {
      condominiumId: rulesAlamedaId,
      name: 'Recargo / multa',
      keywords: ['multa', 'recargo', 'mora', 'penalización', 'penalizacion'],
      unitPatterns: [] as string[],
      conceptType: 'FINE',
      confidenceThreshold: new Prisma.Decimal('0.85'),
      priority: 5,
      isActive: true,
    },
    {
      condominiumId: rulesAlamedaId,
      name: 'Reservación de amenidad',
      keywords: ['salón', 'salon', 'alberca', 'amenidad', 'reserva', 'reservación'],
      unitPatterns: [] as string[],
      conceptType: 'AMENITY',
      confidenceThreshold: new Prisma.Decimal('0.80'),
      priority: 6,
      isActive: true,
    },
  ];

  let totalRules = 0;
  for (const condo of condominiums) {
    await prisma.reconciliationRule.createMany({ data: baseRules(condo.id) });
    totalRules += 3;
  }
  await prisma.reconciliationRule.createMany({ data: alamedaExtraRules });
  totalRules += alamedaExtraRules.length;
  console.log(`✅ Reconciliation rules: ${totalRules}`);

  // ─── System roles (Dynamic RBAC) ─────────────────────────────────────────────
  // Seed the keyed system roles from the code catalog. Users below are linked to
  // the role matching their UserRole enum value (keys are aligned 1:1), so roleId
  // is backfilled by construction. Custom roles are created later from the UI.
  console.log('🛡️  Seeding system roles...');
  const systemRoleIdByKey: Record<string, string> = {};
  for (const r of SYSTEM_ROLES) {
    const created = await prisma.role.create({
      data: {
        key: r.key,
        name: r.name,
        description: r.description,
        isSystem: true,
        isActive: true,
        condominiumId: null,
        permissions: [...r.permissions],
      },
    });
    systemRoleIdByKey[r.key] = created.id;
  }
  console.log(`✅ System roles: ${SYSTEM_ROLES.length}`);

  // ─── Users ─────────────────────────────────────────────────────────────────
  // 1 ROOT + 2-5 per condominium ≈ 26 total; ~15 active, ~11 inactive

  const userRows: {
    email: string; passwordHash: string; role: string;
    firstName: string; lastName: string; phone: string;
    isActive: boolean; condominiumId: string | null;
  }[] = [
    { email: 'root@demo.com', passwordHash: hashRoot, role: 'ROOT', firstName: 'Admin', lastName: 'Root', phone: '+52 81 1000 0000', isActive: true, condominiumId: null },
  ];

  const perCondoUsers: Array<{ email: string; ph: string; role: string; firstName: string; lastName: string; phone: string; active: boolean }[]> = [
    // 0 cotoalameda
    [
      { email: 'supervisor@cotoalameda.com', ph: hashSupervisor, role: 'SUPERVISOR', firstName: 'Rodrigo', lastName: 'Salinas', phone: '+52 81 8356 1200', active: true },
      { email: 'admin@cotoalameda.com', ph: hashAdmin, role: 'TENANT_ADMIN', firstName: 'Carlos', lastName: 'Mendoza', phone: '+52 81 8356 1201', active: true },
      { email: 'view@cotoalameda.com', ph: hashView, role: 'READ_ONLY', firstName: 'Ana', lastName: 'Torres', phone: '+52 81 8356 1202', active: true },
      { email: 'guard@cotoalameda.com', ph: hashGuard, role: 'GUARD', firstName: 'Roberto', lastName: 'Flores', phone: '+52 81 8356 1203', active: false },
      { email: 'vecino@cotoalameda.com', ph: hashNeighbor, role: 'RESIDENT', firstName: 'Daniela', lastName: 'Ríos', phone: '+52 81 8356 1204', active: true },
    ],
    // 1 cotolospatos
    [
      { email: 'admin@cotolospatos.com', ph: hashAdmin, role: 'TENANT_ADMIN', firstName: 'Laura', lastName: 'Ramírez', phone: '+52 33 3841 5601', active: true },
      { email: 'view@cotolospatos.com', ph: hashView, role: 'READ_ONLY', firstName: 'Miguel', lastName: 'Herrera', phone: '+52 33 3841 5602', active: false },
    ],
    // 2 cotoencinos
    [
      { email: 'admin@cotoencinos.com', ph: hashAdmin, role: 'TENANT_ADMIN', firstName: 'Fernando', lastName: 'Castro', phone: '+52 81 8125 4401', active: true },
      { email: 'view@cotoencinos.com', ph: hashView, role: 'READ_ONLY', firstName: 'Patricia', lastName: 'Moreno', phone: '+52 81 8125 4402', active: false },
    ],
    // 3 bosquesdellago
    [
      { email: 'admin@bosquesdellago.com', ph: hashAdmin, role: 'TENANT_ADMIN', firstName: 'Ricardo', lastName: 'Vargas', phone: '+52 55 5245 8801', active: true },
      { email: 'guard@bosquesdellago.com', ph: hashGuard, role: 'GUARD', firstName: 'Héctor', lastName: 'Jiménez', phone: '+52 55 5245 8802', active: false },
    ],
    // 4 cotovalledorado
    [
      { email: 'admin@cotovalledorado.com', ph: hashAdmin, role: 'TENANT_ADMIN', firstName: 'Claudia', lastName: 'Reyes', phone: '+52 33 3680 2201', active: false },
      { email: 'view@cotovalledorado.com', ph: hashView, role: 'READ_ONLY', firstName: 'Ernesto', lastName: 'Aguilar', phone: '+52 33 3680 2202', active: true },
    ],
    // 5 vistaroble
    [
      { email: 'admin@vistaroble.com', ph: hashAdmin, role: 'TENANT_ADMIN', firstName: 'Valeria', lastName: 'Ortiz', phone: '+52 442 215 7701', active: true },
      { email: 'view@vistaroble.com', ph: hashView, role: 'READ_ONLY', firstName: 'Diego', lastName: 'Ramos', phone: '+52 442 215 7702', active: false },
    ],
    // 6 puertadelsol
    [
      { email: 'admin@puertadelsol.com', ph: hashAdmin, role: 'TENANT_ADMIN', firstName: 'Javier', lastName: 'Guerrero', phone: '+52 33 3777 9901', active: false },
      { email: 'guard@puertadelsol.com', ph: hashGuard, role: 'GUARD', firstName: 'Gabriela', lastName: 'Medina', phone: '+52 33 3777 9902', active: true },
    ],
    // 7 jardinesdelvalley
    [
      { email: 'admin@jardinesdelvalley.com', ph: hashAdmin, role: 'TENANT_ADMIN', firstName: 'Isabel', lastName: 'Díaz', phone: '+52 81 8421 3301', active: true },
      { email: 'view@jardinesdelvalley.com', ph: hashView, role: 'READ_ONLY', firstName: 'Antonio', lastName: 'Pérez', phone: '+52 81 8421 3302', active: false },
      { email: 'guard@jardinesdelvalley.com', ph: hashGuard, role: 'GUARD', firstName: 'Sofía', lastName: 'López', phone: '+52 81 8421 3303', active: true },
    ],
    // 8 altosdelparque
    [
      { email: 'admin@altosdelparque.com', ph: hashAdmin, role: 'TENANT_ADMIN', firstName: 'Mónica', lastName: 'Álvarez', phone: '+52 222 245 1101', active: true },
      { email: 'view@altosdelparque.com', ph: hashView, role: 'READ_ONLY', firstName: 'Luis', lastName: 'Romero', phone: '+52 222 245 1102', active: false },
    ],
    // 9 senderosdelsbosque
    [
      { email: 'admin@senderosdelsbosque.com', ph: hashAdmin, role: 'TENANT_ADMIN', firstName: 'Pedro', lastName: 'González', phone: '+52 477 718 4401', active: false },
      { email: 'view@senderosdelsbosque.com', ph: hashView, role: 'READ_ONLY', firstName: 'Elena', lastName: 'Ruiz', phone: '+52 477 718 4402', active: true },
    ],
  ];

  const createdUserIds: Record<string, string> = {};

  // ROOT user
  const rootUser = await prisma.user.create({
    data: {
      email: 'root@demo.com', passwordHash: hashRoot,
      roleId: systemRoleIdByKey['ROOT'],
      firstName: 'Admin', lastName: 'Root', phone: '+52 81 1000 0000',
      isActive: true, condominiumId: null,
    },
  });
  createdUserIds['root@demo.com'] = rootUser.id;

  for (let ci = 0; ci < condominiums.length; ci++) {
    const condoId = condominiums[ci].id;
    for (const u of perCondoUsers[ci]) {
      const created = await prisma.user.create({
        data: {
          email: u.email, passwordHash: u.ph,
          roleId: systemRoleIdByKey[u.role],
          firstName: u.firstName, lastName: u.lastName, phone: u.phone,
          isActive: u.active, condominiumId: condoId,
        },
      });
      createdUserIds[u.email] = created.id;
    }
  }

  const totalUsers = Object.keys(createdUserIds).length;
  console.log(`✅ Users: ${totalUsers}`);

  // ─── Residents ─────────────────────────────────────────────────────────────
  // cotoalameda (ci=0): loaded from prisma/seed-data/residents.csv (Principal rows only)
  // all other condominiums: 5 synthetic residents each
  const csvPath = path.join(process.cwd(), 'prisma', 'seed-data', 'residents.csv');
  const csvRows = parseResidentsCsv(csvPath).filter((r) => r.tipoUsuario === 'Principal');
  const seenUnits = new Set<string>();
  const csvResidents = csvRows.filter((r) => {
    if (seenUnits.has(r.unidad)) return false;
    seenUnits.add(r.unidad);
    return true;
  });

  let totalResidents = 0;

  for (let ci = 0; ci < condominiums.length; ci++) {
    const condoId = condominiums[ci].id;
    const fee = condominiums[ci].settings.ordinaryFeeAmount;

    if (ci === 0) {
      // Load real residents from CSV for cotoalameda
      const residents = csvResidents.map((row) => {
        const { firstName, lastName } = splitName(row.nombre);
        return {
          condominiumId: condoId,
          unitNumber: row.unidad,
          firstName,
          lastName,
          residentType: csvResidentType(row.perfil),
          paymentStatus: 'CURRENT' as PaymentStatus,
          debt: 0,
          monthlyFee: fee,
          parkingSpots: 0,
          phone: row.celular ? row.celular.replace(/\s+/g, '') : null,
          secondaryPhone: row.telefono ? row.telefono.replace(/\s+/g, '') : null,
          email: row.email || null,
        };
      });

      await prisma.resident.createMany({ data: residents });
      totalResidents += residents.length;
    } else {
      const residents = Array.from({ length: 5 }, (_, ui) => {
        const payStatus = PAYMENT_STATUSES[(ci + ui) % PAYMENT_STATUSES.length];
        return {
          condominiumId: condoId,
          unitNumber: String(ui + 1),
          firstName: nameAt(FIRST_NAMES, ci, ui),
          lastName: nameAt(LAST_NAMES, ci, ui + 5),
          residentType: RESIDENT_TYPES[(ci + ui) % RESIDENT_TYPES.length],
          paymentStatus: payStatus,
          debt: payStatus === 'OVERDUE' ? fee * 2 : 0,
          monthlyFee: fee,
          parkingSpots: ui % 3,
          phone: `+52 81 ${String(8000 + ci * 10 + ui).padStart(4, '0')} ${String(1000 + ui).padStart(4, '0')}`,
          email: `residente${ui + 1}.${condominiums[ci].slug}@demo.com`,
        };
      });

      await prisma.resident.createMany({ data: residents });
      totalResidents += residents.length;
    }
  }
  console.log(`✅ Residents: ${totalResidents}`);

  // ─── Common Areas + Inventory Items ───────────────────────────────────────
  let totalAreas = 0;
  let totalItems = 0;

  for (let ci = 0; ci < condominiums.length; ci++) {
    const condoId = condominiums[ci].id;
    const isSecurityType = ci % 2 === 0;
    const areaTemplates = isSecurityType ? AREAS_SECURITY : AREAS_AMENITIES;
    const prefix = condominiums[ci].slug.slice(0, 6).toUpperCase();

    const areaIds: string[] = [];
    for (const tpl of areaTemplates) {
      const area = await prisma.commonArea.create({
        data: { condominiumId: condoId, ...tpl },
      });
      areaIds.push(area.id);
      totalAreas++;
    }

    const items = buildInventoryItems(condoId, areaIds, prefix, isSecurityType);
    await prisma.inventoryItem.createMany({ data: items });
    totalItems += items.length;
  }

  console.log(`✅ Common Areas: ${totalAreas}`);
  console.log(`✅ Inventory Items: ${totalItems}`);

  // ─── Suppliers ─────────────────────────────────────────────────────────────
  const SUPPLIER_SEED: Prisma.SupplierCreateManyInput[] = [
    { condominiumId: '', supplierName: 'Constructora Vidal Hermanos', type: 'MAINTENANCE', contactName: 'Luis Vidal', email: 'lvidal@vidal.mx', phone: '555-201-4432', address: 'Av. Industrial 330', taxId: 'CVH220801VH3', registrationDate: new Date('2026-05-06'), status: 'ACTIVE' },
    { condominiumId: '', supplierName: 'Seguridad Privada Escudo', type: 'SECURITY', contactName: 'María Escobedo', email: 'mescobedo@escudo.mx', phone: '555-301-7890', address: 'Blvd. Seguridad 12', taxId: 'SPE190515SE1', registrationDate: new Date('2026-04-29'), status: 'ACTIVE' },
    { condominiumId: '', supplierName: 'Electro Soluciones del Centro', type: 'ELECTRICAL', contactName: 'Jorge Ramírez', email: 'jramirez@electrosol.mx', phone: '555-440-1122', address: 'Calle Voltio 45', taxId: 'ESC210310EC7', registrationDate: new Date('2026-03-18'), status: 'ACTIVE' },
    { condominiumId: '', supplierName: 'Plomería Aqua Express', type: 'PLUMBING', contactName: 'Sofía Marín', email: 'smarin@aquaexpress.mx', phone: '555-555-9090', address: 'Av. Tubería 88', taxId: 'PAE200722PE5', registrationDate: new Date('2026-02-11'), status: 'PENDING' },
    { condominiumId: '', supplierName: 'Jardines y Paisajes Verde Vivo', type: 'LANDSCAPING', contactName: 'Andrés Lozano', email: 'alozano@verdevivo.mx', phone: '555-612-3344', address: 'Camino Real 210', taxId: 'JPV180905VV2', registrationDate: new Date('2025-11-30'), status: 'INACTIVE' },
    { condominiumId: '', supplierName: 'Limpieza Integral Brillo Total', type: 'CLEANING', contactName: 'Patricia Núñez', email: 'pnunez@brillototal.mx', phone: '555-778-5566', address: 'Privada Aseo 9', taxId: 'LIB220114BT8', registrationDate: new Date('2026-01-20'), status: 'ACTIVE' },
  ];

  let totalSuppliers = 0;
  for (let ci = 0; ci < condominiums.length; ci++) {
    const condoId = condominiums[ci].id;
    const rows = SUPPLIER_SEED.map((s) => ({ ...s, condominiumId: condoId }));
    await prisma.supplier.createMany({ data: rows });
    totalSuppliers += rows.length;
  }
  console.log(`✅ Suppliers: ${totalSuppliers}`);

  // ─── Petty Cash (first 3 condominiums) ────────────────────────────────────
  const pettyCashData = [
    {
      condoIdx: 0,
      adminEmail: 'admin@cotoalameda.com',
      movements: [
        { folio: 'PC-0001', date: new Date('2026-01-10'), movementType: 'ENTRY' as MovementType, category: 'OTHER' as MovementCategory, concept: 'Apertura de fondo de caja chica', amount: 5000, runningBalance: 5000, status: 'APPROVED' as MovementStatus, deliveryMethod: 'TRANSFER' as DeliveryMethod, responsible: 'Carlos Mendoza', hasReceipt: true, receiptNumber: 'TRF-001', authorizedBy: 'Carlos Mendoza', notes: 'Fondo inicial del ejercicio 2026' },
        { folio: 'PC-0002', date: new Date('2026-01-15'), movementType: 'EXIT' as MovementType, category: 'CLEANING' as MovementCategory, concept: 'Compra de artículos de limpieza', amount: 450, runningBalance: 4550, status: 'APPROVED' as MovementStatus, deliveryMethod: 'CASH' as DeliveryMethod, responsible: 'Ana Torres', supplier: 'Artículos de Limpieza S.A.', hasReceipt: true, receiptNumber: 'REC-001', authorizedBy: 'Carlos Mendoza', notes: null },
        { folio: 'PC-0003', date: new Date('2026-01-20'), movementType: 'EXIT' as MovementType, category: 'MAINTENANCE' as MovementCategory, concept: 'Reemplazo de luminarias pasillo norte', amount: 320, runningBalance: 4230, status: 'PENDING' as MovementStatus, deliveryMethod: 'CASH' as DeliveryMethod, responsible: 'Roberto Flores', hasReceipt: true, receiptNumber: 'REC-002', authorizedBy: null, notes: null },
      ],
    },
    {
      condoIdx: 1,
      adminEmail: 'admin@cotolospatos.com',
      movements: [
        { folio: 'PC-0001', date: new Date('2026-02-01'), movementType: 'ENTRY' as MovementType, category: 'OTHER' as MovementCategory, concept: 'Apertura de fondo caja chica', amount: 3000, runningBalance: 3000, status: 'APPROVED' as MovementStatus, deliveryMethod: 'TRANSFER' as DeliveryMethod, responsible: 'Laura Ramírez', hasReceipt: true, receiptNumber: 'TRF-001', authorizedBy: 'Laura Ramírez', notes: null },
        { folio: 'PC-0002', date: new Date('2026-02-10'), movementType: 'EXIT' as MovementType, category: 'GARDENING' as MovementCategory, concept: 'Compra de fertilizante y semillas', amount: 680, runningBalance: 2320, status: 'APPROVED' as MovementStatus, deliveryMethod: 'CASH' as DeliveryMethod, responsible: 'Laura Ramírez', supplier: 'Viveros del Valle', hasReceipt: true, receiptNumber: 'REC-001', authorizedBy: 'Laura Ramírez', notes: null },
      ],
    },
    {
      condoIdx: 2,
      adminEmail: 'admin@cotoencinos.com',
      movements: [
        { folio: 'PC-0001', date: new Date('2026-02-15'), movementType: 'ENTRY' as MovementType, category: 'OTHER' as MovementCategory, concept: 'Apertura de fondo operativo', amount: 4000, runningBalance: 4000, status: 'APPROVED' as MovementStatus, deliveryMethod: 'TRANSFER' as DeliveryMethod, responsible: 'Fernando Castro', hasReceipt: true, receiptNumber: 'TRF-001', authorizedBy: 'Fernando Castro', notes: null },
        { folio: 'PC-0002', date: new Date('2026-02-20'), movementType: 'EXIT' as MovementType, category: 'STATIONERY' as MovementCategory, concept: 'Material de oficina', amount: 290, runningBalance: 3710, status: 'APPROVED' as MovementStatus, deliveryMethod: 'CASH' as DeliveryMethod, responsible: 'Patricia Moreno', supplier: 'Papelería Central', hasReceipt: true, receiptNumber: 'REC-001', authorizedBy: 'Fernando Castro', notes: null },
        { folio: 'PC-0003', date: new Date('2026-03-01'), movementType: 'EXIT' as MovementType, category: 'SERVICES' as MovementCategory, concept: 'Reparación de portón eléctrico', amount: 1200, runningBalance: 2510, status: 'REJECTED' as MovementStatus, deliveryMethod: 'TRANSFER' as DeliveryMethod, responsible: 'Fernando Castro', supplier: 'Electro Servicios MX', hasReceipt: false, receiptNumber: null, authorizedBy: null, notes: 'Rechazado: requiere mayor cotización' },
      ],
    },
  ];

  let totalMovements = 0;
  for (const pc of pettyCashData) {
    const condoId = condominiums[pc.condoIdx].id;
    const adminId = createdUserIds[pc.adminEmail];
    await prisma.pettyCashMovement.createMany({
      data: pc.movements.map((m) => ({
        condominiumId: condoId,
        registeredById: adminId,
        folio: m.folio,
        date: m.date,
        movementType: m.movementType,
        category: m.category,
        concept: m.concept,
        amount: m.amount,
        runningBalance: m.runningBalance,
        status: m.status,
        deliveryMethod: m.deliveryMethod,
        responsible: m.responsible,
        supplier: m.supplier ?? null,
        hasReceipt: m.hasReceipt,
        receiptNumber: m.receiptNumber ?? null,
        authorizedBy: m.authorizedBy ?? null,
        notes: m.notes ?? null,
      })),
    });
    totalMovements += pc.movements.length;
  }
  console.log(`✅ Petty cash movements: ${totalMovements}`);

  // ─── Audit Logs (first condominium) ───────────────────────────────────────
  const alamedaId = condominiums[0].id;
  const alamedaAdminId = createdUserIds['admin@cotoalameda.com'];

  await prisma.auditLog.createMany({
    data: [
      { condominiumId: alamedaId, userId: alamedaAdminId, action: 'USER_LOGGED_IN', actionCategory: 'Authentication', module: 'auth', result: 'SUCCESS' as AuditResult, description: 'Inicio de sesión exitoso', ipAddress: '192.168.1.10' },
      { condominiumId: alamedaId, userId: alamedaAdminId, action: 'SETTINGS_UPDATED', actionCategory: 'Configuration', module: 'settings', result: 'SUCCESS' as AuditResult, description: 'Configuración general actualizada' },
      { condominiumId: alamedaId, userId: alamedaAdminId, action: 'RESIDENT_CREATED', actionCategory: 'Residents', module: 'residents', result: 'SUCCESS' as AuditResult, description: 'Residente creado: unidad 1' },
      { condominiumId: alamedaId, userId: rootUser.id, action: 'USER_LOGGED_IN', actionCategory: 'Authentication', module: 'auth', result: 'SUCCESS' as AuditResult, description: 'Inicio de sesión ROOT', ipAddress: '10.0.0.1' },
    ],
  });
  console.log('✅ Audit logs: 4');

  // ─── Calendar Events (first two condominiums) ─────────────────────────────
  const now = new Date('2026-05-11T00:00:00.000Z');
  const d = (offsetDays: number, hour: number) => {
    const dt = new Date(now);
    dt.setDate(dt.getDate() + offsetDays);
    dt.setUTCHours(hour, 0, 0, 0);
    return dt;
  };

  await prisma.calendarEvent.createMany({
    data: [
      {
        condominiumId: alamedaId,
        createdById: alamedaAdminId,
        title: 'Reservación Terraza - Familia Martínez',
        eventType: EventType.TERRACE_BOOKING,
        startDate: d(3, 18),
        endDate: d(3, 23),
        location: 'Terraza A',
        unitNumber: 'A-14',
        status: EventStatus.CONFIRMED,
      },
      {
        condominiumId: alamedaId,
        createdById: alamedaAdminId,
        title: 'Asamblea General Ordinaria',
        description: 'Revisión de presupuesto anual y elección de comité',
        eventType: EventType.ASSEMBLY,
        startDate: d(7, 19),
        endDate: d(7, 21),
        location: 'Salón de usos múltiples',
        status: EventStatus.CONFIRMED,
      },
      {
        condominiumId: alamedaId,
        createdById: alamedaAdminId,
        title: 'Mantenimiento Elevadores',
        description: 'Revisión anual por OTIS México',
        eventType: EventType.MAINTENANCE,
        startDate: d(10, 9),
        endDate: d(10, 17),
        location: 'Torres A y B',
        status: EventStatus.PENDING,
      },
      {
        condominiumId: alamedaId,
        createdById: alamedaAdminId,
        title: 'Reservación Terraza - Familia Gutiérrez',
        eventType: EventType.TERRACE_BOOKING,
        startDate: d(14, 17),
        endDate: d(14, 22),
        location: 'Terraza A',
        unitNumber: 'B-07',
        status: EventStatus.PENDING,
      },
      {
        condominiumId: alamedaId,
        createdById: alamedaAdminId,
        title: 'Junta de Consejo',
        description: 'Revisión mensual de estados financieros',
        eventType: EventType.COUNCIL_MEETING,
        startDate: d(21, 19),
        endDate: d(21, 21),
        location: 'Oficina de administración',
        status: EventStatus.PENDING,
      },
      {
        condominiumId: condominiums[1].id,
        createdById: createdUserIds['admin@cotolospatos.com'],
        title: 'Revisión Cisterna y Bomba de Agua',
        eventType: EventType.MAINTENANCE,
        startDate: d(5, 10),
        endDate: d(5, 14),
        location: 'Cuarto de máquinas',
        status: EventStatus.CONFIRMED,
      },
    ],
  });
  console.log('✅ Calendar events: 6');

  // ─── Summary ───────────────────────────────────────────────────────────────
  console.log('\n✨ Seed completed successfully!');
  // DEV-ONLY: prints demo login credentials for the local development seed.
  // Safe because the guard at the top of main() blocks this seed in production.
  console.log('\n📋 Test accounts:');
  console.log('   root@demo.com                / Root1234!   (ROOT)');
  console.log('   admin@cotoalameda.com        / Admin1234!  (TENANT_ADMIN)');
  console.log('   view@cotoalameda.com         / View1234!   (READ_ONLY)');
  console.log('   guard@cotoalameda.com        / Guard1234!  (GUARD, inactive)');
  console.log('   admin@cotolospatos.com       / Admin1234!  (TENANT_ADMIN)');
  console.log('   admin@bosquesdellago.com     / Admin1234!  (TENANT_ADMIN)');
  console.log('   admin@jardinesdelvalley.com  / Admin1234!  (TENANT_ADMIN)');
  console.log('\n📊 Counts:');
  console.log(`   Condominiums  : ${condominiums.length}`);
  console.log(`   Rules         : ${totalRules}`);
  console.log(`   Users         : ${totalUsers}`);
  console.log(`   Residents     : ${totalResidents}`);
  console.log(`   Common Areas  : ${totalAreas}`);
  console.log(`   Inventory     : ${totalItems}`);
  console.log(`   Petty Cash    : ${totalMovements}`);
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
