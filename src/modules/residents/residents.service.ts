import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePetDto } from './dto/create-pet.dto';
import { CreateResidentDto } from './dto/create-resident.dto';
import { CreateVehicleDto } from './dto/create-vehicle.dto';

@Injectable()
export class ResidentsService {
  constructor(private prisma: PrismaService) {}

  async findAll(condominiumId: string) {
    return this.prisma.resident.findMany({
      where: { condominiumId, deletedAt: null },
      include: {
        vehicles: true,
        pets: true,
        additionalResidents: true,
      },
      orderBy: { unitNumber: 'asc' },
    });
  }

  async findOne(condominiumId: string, id: string) {
    const resident = await this.prisma.resident.findFirst({
      where: { id, condominiumId, deletedAt: null },
      include: {
        vehicles: true,
        pets: true,
        additionalResidents: true,
        collectionRecords: { orderBy: [{ year: 'desc' }, { month: 'desc' }], take: 12 },
      },
    });

    if (!resident) {
      throw new NotFoundException('Resident not found');
    }

    return resident;
  }

  async create(condominiumId: string, dto: CreateResidentDto) {
    const existing = await this.prisma.resident.findFirst({
      where: { condominiumId, unitNumber: dto.unitNumber, deletedAt: null },
    });

    if (existing) {
      throw new ConflictException(
        `Unit ${dto.unitNumber} already has an active resident`,
      );
    }

    return this.prisma.resident.create({
      data: {
        condominiumId,
        unitNumber: dto.unitNumber,
        residentType: dto.residentType,
        firstName: dto.firstName,
        lastName: dto.lastName,
        phone: dto.phone,
        secondaryPhone: dto.secondaryPhone,
        email: dto.email,
        monthlyFee: dto.monthlyFee ?? 0,
        parkingSpots: dto.parkingSpots ?? 0,
        notes: dto.notes,
      },
      include: { vehicles: true, pets: true, additionalResidents: true },
    });
  }

  async update(condominiumId: string, id: string, dto: Partial<CreateResidentDto>) {
    await this.findOne(condominiumId, id);

    return this.prisma.resident.update({
      where: { id },
      data: dto,
      include: { vehicles: true, pets: true, additionalResidents: true },
    });
  }

  async remove(condominiumId: string, id: string) {
    await this.findOne(condominiumId, id);

    return this.prisma.resident.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async addVehicle(condominiumId: string, residentId: string, dto: CreateVehicleDto) {
    await this.findOne(condominiumId, residentId);

    return this.prisma.vehicle.create({
      data: { ...dto, residentId, condominiumId },
    });
  }

  async updateVehicle(
    condominiumId: string,
    residentId: string,
    vehicleId: string,
    dto: Partial<CreateVehicleDto>,
  ) {
    await this.findOne(condominiumId, residentId);
    return this.prisma.vehicle.update({ where: { id: vehicleId }, data: dto });
  }

  async removeVehicle(condominiumId: string, residentId: string, vehicleId: string) {
    await this.findOne(condominiumId, residentId);
    return this.prisma.vehicle.delete({ where: { id: vehicleId } });
  }

  async addPet(condominiumId: string, residentId: string, dto: CreatePetDto) {
    await this.findOne(condominiumId, residentId);
    return this.prisma.pet.create({ data: { ...dto, residentId } });
  }

  async updatePet(
    condominiumId: string,
    residentId: string,
    petId: string,
    dto: Partial<CreatePetDto>,
  ) {
    await this.findOne(condominiumId, residentId);
    return this.prisma.pet.update({ where: { id: petId }, data: dto });
  }

  async removePet(condominiumId: string, residentId: string, petId: string) {
    await this.findOne(condominiumId, residentId);
    return this.prisma.pet.delete({ where: { id: petId } });
  }
}
