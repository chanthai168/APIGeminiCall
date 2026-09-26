import { Controller, Get,Post,Body, Put,Param, Delete,UseGuards,UseInterceptors } from '@nestjs/common';
import { UsersService } from './users.service.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { LoggingInterceptor } from '../../common/interceptors/Logging.interceptor.js';
import { TransformInterceptor } from '../../common/interceptors/transform.interceptor.js';
import { User } from '../../common/decorators/user.decorator.js';
import type { AuthObject } from '@clerk/backend';


@UseInterceptors(LoggingInterceptor)
@Controller('users')
export class UsersController {
    constructor(private readonly usersService:UsersService){};

    @Post()
    async createUser(@Body() createUserDto:CreateUserDto):Promise<string> {
        return await this.usersService.createUser(createUserDto);
    }

    @Put(':id')
    async updateUser(@Body() updateUserDto:UpdateUserDto,@Param('id') id:string): Promise<string> {
        return await this.usersService.updateUser(updateUserDto,id);
    }

    @Roles(['USER']) 
    // @UseGuards(AuthGuard,RoleGuard)
    @UseInterceptors(TransformInterceptor)
    @Get()
    async getUser(@User() user:AuthObject):Promise<string>{
        console.log(user);
        // return await this.usersService.getUsers();
        return "You would get user";
    }

    @Delete()
    async deleteUser(@Param('id') id:string):Promise<string>{
        return await this.usersService.deleteUser(id);
    }

}
