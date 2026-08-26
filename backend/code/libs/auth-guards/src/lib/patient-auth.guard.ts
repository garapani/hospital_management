import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';

/**
 * Gate for /patient-portal/* routes: rejects any caller whose JWT isn't a patient-portal
 * account, structurally separate from PermissionGuard/the staff RBAC catalog (a patient has no
 * roles or permissions to check). A staff account's JWT never carries accountType: 'patient',
 * so this can't be bypassed by a staff member holding some coincidentally-named permission.
 */
@Injectable()
export class PatientAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    if (request.authContext?.accountType !== 'patient') {
      throw new ForbiddenException('This endpoint is only available to patient-portal accounts');
    }
    return true;
  }
}
