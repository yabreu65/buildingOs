import {
  Controller,
  Post,
  Body,
  Get,
  UseGuards,
  Request,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService, AuthResponse } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { SignupDto } from './dto/signup.dto';
import { JwtAuthGuard } from './jwt-auth.guard';

interface RequestWithUser extends Request {
  user: {
    id: string;
    email: string;
    name: string;
    memberships: Array<{
      tenantId: string;
      roles: string[];
    }>;
  };
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('signup')
  async signup(@Body() signupDto: SignupDto): Promise<AuthResponse> {
    return this.authService.signup(signupDto);
  }

  @Post('login')
  async login(@Body() loginDto: LoginDto): Promise<AuthResponse> {
    const user = await this.authService.validateUser(
      loginDto.email,
      loginDto.password,
    );
    if (!user) {
      // Audit: AUTH_FAILED_LOGIN
      await this.authService.logFailedLogin(loginDto.email);
      throw new UnauthorizedException('Credenciales inválidas');
    }
    return this.authService.login(user);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async getProfile(@Request() req: RequestWithUser): Promise<Omit<AuthResponse, 'accessToken'>> {
    // req.user contiene { id, email, name, memberships }
    // Retornar en formato esperado por el frontend
    return {
      user: {
        id: req.user.id,
        email: req.user.email,
        name: req.user.name,
      },
      memberships: req.user.memberships,
    };
  }
}
