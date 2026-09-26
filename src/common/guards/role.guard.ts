
import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Roles } from '../decorators/roles.decorator.js';

@Injectable()
export class RoleGuard implements CanActivate {
    constructor(private readonly reflector:Reflector ){}

    async canActivate(context: ExecutionContext): Promise<boolean>{
        const requiredRoles = this.reflector.getAllAndOverride(Roles,[context.getHandler(), context.getClass()]);
        console.log('')
        console.log("---- Role guard ran -----")
        console.log(requiredRoles);
        
        const hasRole = requiredRoles.some(role => role.includes('USER'));
        
        if(hasRole){
            console.log(`This user is in "User" role`)
        }

        // we can than switch execution context to http so we can get req.user 
        return true;
    }
}