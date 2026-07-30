import 'reflect-metadata';

const AUDIT_EXCLUDE_KEY = 'auditExcludeFields';

export function AuditExclude(): PropertyDecorator {
  return (target, propertyKey) => {
    const existing: string[] = Reflect.getMetadata(AUDIT_EXCLUDE_KEY, target.constructor) ?? [];
    Reflect.defineMetadata(
      AUDIT_EXCLUDE_KEY,
      [...existing, propertyKey.toString()],
      target.constructor,
    );
  };
}

export function getAuditExcludedFields(entityClass: () => void): string[] {
  return Reflect.getMetadata(AUDIT_EXCLUDE_KEY, entityClass) ?? [];
}
