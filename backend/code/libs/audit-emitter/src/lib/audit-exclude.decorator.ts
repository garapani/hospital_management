import 'reflect-metadata';

const AUDIT_EXCLUDE_KEY = 'auditExcludeFields';
const AUDIT_EXCLUDE_ENTITY_KEY = 'auditExcludeEntity';

export type EntityClass = new (...args: unknown[]) => unknown;

export function AuditExclude(): PropertyDecorator {
  return (target, propertyKey) => {
    const existing: string[] =
      Reflect.getMetadata(AUDIT_EXCLUDE_KEY, target.constructor) ?? [];
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

export function AuditExcludeEntity(): ClassDecorator {
  return (target) => {
    Reflect.defineMetadata(AUDIT_EXCLUDE_ENTITY_KEY, true, target);
  };
}

export function isAuditExcludedEntity(entityClass: EntityClass): boolean {
  return Reflect.getMetadata(AUDIT_EXCLUDE_ENTITY_KEY, entityClass) === true;
}
