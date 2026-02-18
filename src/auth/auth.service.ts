import { Injectable, ConflictException, UnauthorizedException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';
import { User } from '../database/schemas';
import { ConfigService } from '../common/config/config.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { AuthPayload } from '../common/types';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    private readonly configService: ConfigService,
  ) {}

  async register(dto: RegisterDto) {
    const { username, password, walletAddress, email } = dto;

    const existingUsername = await this.userModel.findOne({ username });
    if (existingUsername) {
      throw new ConflictException('Username is already taken');
    }

    const existingWallet = await this.userModel.findOne({ walletAddress });
    if (existingWallet) {
      throw new ConflictException('Wallet address is already registered');
    }

    if (email) {
      const existingEmail = await this.userModel.findOne({ email });
      if (existingEmail) {
        throw new ConflictException('Email is already registered');
      }
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const user = await this.userModel.create({
      username,
      passwordHash,
      walletAddress,
      email: email ?? null,
      balance: 0,
    });

    const payload: AuthPayload = { userId: user._id.toString(), username: user.username };
    const token = this.generateToken(payload);

    this.logger.log(`New user registered: ${username}`);

    return {
      token,
      user: this.sanitizeUser(user),
    };
  }

  async login(dto: LoginDto) {
    const { username, password } = dto;

    const user = await this.userModel.findOne({ username });
    if (!user) {
      throw new UnauthorizedException('Invalid username or password');
    }

    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      throw new UnauthorizedException('Invalid username or password');
    }

    const payload: AuthPayload = { userId: user._id.toString(), username: user.username };
    const token = this.generateToken(payload);

    this.logger.log(`User logged in: ${username}`);

    return {
      token,
      user: this.sanitizeUser(user),
    };
  }

  async getProfile(userId: string) {
    const user = await this.userModel.findById(userId);
    if (!user) {
      return null;
    }
    return { user: this.sanitizeUser(user) };
  }

  private generateToken(payload: AuthPayload): string {
    return jwt.sign(payload as object, this.configService.jwtSecret, {
      expiresIn: this.configService.jwtExpiresIn as string,
    } as jwt.SignOptions);
  }

  private sanitizeUser(user: User) {
    return {
      id: user._id.toString(),
      username: user.username,
      walletAddress: user.walletAddress,
      email: user.email,
      balance: user.balance,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}
