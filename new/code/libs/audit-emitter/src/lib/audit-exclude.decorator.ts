import 'reflect-metadata';

const AUDIT_EXCLUDE_KEY = 'auditExcludeFields';

export type EntityClass = new (...args: unknown[]) => unknown;

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

export function getAuditExcludedFields(entityClass: EntityClass): string[] {
  return Reflect.getMetadata(AUDIT_EXCLUDE_KEY, entityClass) ?? [];
}
