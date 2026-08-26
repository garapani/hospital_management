import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * SQUASHED PLATFORM BASELINE (2026-08-27): the consolidated public-schema state of migrations
 * 0001, 0003, 0005, 0027, 0029, 0048, 0050-0052, 0054-0056, 0060, 0064 and 0084 (15 migrations,
 * ~15 files) in final shape, generated from `pg_dump --schema-only` of a fully-migrated public
 * schema, NOT hand-written. The whole 0001->0084 ALTER chain collapsed into final CREATE TABLE
 * statements. See Development-Standards.md §108 (the squash record) before touching this file.
 *
 * Rules that apply to this file:
 *  - APPEND-ONLY / IMMUTABLE: never edit it. The schema it produces is the contract every
 *    environment starts from; a hand-edit would silently diverge provisioned schemas from
 *    fresh ones. Schema changes ship as NEW migrations appended to PLATFORM_MIGRATIONS.
 *  - SCHEMA ONLY: this baseline carries no seed data. The SaaS packages (formerly migration
 *    0048) are seeded by seedPackagesCatalog() (packages/seed-packages-catalog.ts); the roles/
 *    permissions catalog was never in migrations (seed-rbac-catalog.ts). A fresh platform DB is
 *    ready after `migrate` + `seed-rbac` + `seed-packages` (seed-all does all three).
 *  - `down()` is best-effort (baselines are never reverted in practice; purging a platform
 *    DB means dropping the schema).
 */
export class InitialPlatformSchema1000000000093 implements MigrationInterface {
  name = 'InitialPlatformSchema1000000000093';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // gen_random_uuid() defaults everywhere below need pgcrypto (was migration 0001's job).
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
    await queryRunner.query(`


      SET default_tablespace = '';

      SET default_table_access_method = heap;

      --
      -- Name: department_catalog; Type: TABLE; Schema: public; Owner: -
      --

      CREATE TABLE department_catalog (
          id uuid DEFAULT gen_random_uuid() NOT NULL,
          "departmentCode" character varying NOT NULL,
          "departmentName" character varying NOT NULL,
          description character varying,
          "isActive" boolean DEFAULT true NOT NULL,
          "isAppointmentApplicable" boolean DEFAULT false NOT NULL,
          "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
          "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
          "createdBy" character varying,
          "updatedBy" character varying,
          "deletedAt" timestamp with time zone,
          "deletedBy" character varying
      );


      --


      --
      -- Name: packages; Type: TABLE; Schema: public; Owner: -
      --

      CREATE TABLE packages (
          code character varying NOT NULL,
          name character varying NOT NULL,
          description text,
          modules jsonb NOT NULL,
          "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
          "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
          "createdBy" character varying,
          "updatedBy" character varying,
          "deletedAt" timestamp with time zone,
          "deletedBy" character varying
      );


      --
      -- Name: permissions; Type: TABLE; Schema: public; Owner: -
      --

      CREATE TABLE permissions (
          id uuid DEFAULT gen_random_uuid() NOT NULL,
          name character varying NOT NULL,
          description character varying NOT NULL,
          "isActive" boolean DEFAULT true NOT NULL,
          "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
          "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
          "createdBy" character varying,
          "updatedBy" character varying,
          "deletedAt" timestamp with time zone,
          "deletedBy" character varying
      );


      --
      -- Name: role_permissions; Type: TABLE; Schema: public; Owner: -
      --

      CREATE TABLE role_permissions (
          id uuid DEFAULT gen_random_uuid() NOT NULL,
          "roleId" uuid NOT NULL,
          "permissionId" uuid NOT NULL
      );


      --
      -- Name: roles; Type: TABLE; Schema: public; Owner: -
      --

      CREATE TABLE roles (
          id uuid DEFAULT gen_random_uuid() NOT NULL,
          name character varying NOT NULL,
          description character varying NOT NULL,
          priority integer DEFAULT 0 NOT NULL,
          "isCrossTenant" boolean DEFAULT false NOT NULL,
          "isActive" boolean DEFAULT true NOT NULL,
          "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
          "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
          "createdBy" character varying,
          "updatedBy" character varying,
          "deletedAt" timestamp with time zone,
          "deletedBy" character varying
      );


      --
      -- Name: subscription_invoices; Type: TABLE; Schema: public; Owner: -
      --

      CREATE TABLE subscription_invoices (
          id uuid DEFAULT gen_random_uuid() NOT NULL,
          "subscriptionId" uuid NOT NULL,
          "tenantId" character varying NOT NULL,
          "periodStart" timestamp with time zone NOT NULL,
          "periodEnd" timestamp with time zone NOT NULL,
          amount integer NOT NULL,
          status character varying(10) DEFAULT 'open'::character varying NOT NULL,
          "issuedAt" timestamp with time zone DEFAULT now() NOT NULL,
          "paidAt" timestamp with time zone,
          "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
          "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
          "createdBy" character varying,
          "updatedBy" character varying,
          "deletedAt" timestamp with time zone,
          "deletedBy" character varying,
          "invoiceNumber" character varying,
          "taxPercent" numeric(5,2) DEFAULT 0 NOT NULL,
          "taxAmount" numeric(12,2) DEFAULT 0 NOT NULL
      );


      --
      -- Name: subscriptions; Type: TABLE; Schema: public; Owner: -
      --

      CREATE TABLE subscriptions (
          id uuid DEFAULT gen_random_uuid() NOT NULL,
          "tenantId" character varying NOT NULL,
          "packageCode" character varying NOT NULL,
          "billingCycle" character varying(10) NOT NULL,
          "pricePerCycle" integer NOT NULL,
          status character varying(10) DEFAULT 'active'::character varying NOT NULL,
          "currentPeriodStart" timestamp with time zone NOT NULL,
          "currentPeriodEnd" timestamp with time zone NOT NULL,
          "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
          "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
          "createdBy" character varying,
          "updatedBy" character varying,
          "deletedAt" timestamp with time zone,
          "deletedBy" character varying
      );


      --
      -- Name: tenant_branding; Type: TABLE; Schema: public; Owner: -
      --

      CREATE TABLE tenant_branding (
          "tenantId" character varying NOT NULL,
          "displayName" character varying,
          "primaryColor" character varying(7),
          "logoObjectKey" character varying,
          "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
          "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
          "createdBy" character varying,
          "updatedBy" character varying,
          "deletedAt" timestamp with time zone,
          "deletedBy" character varying,
          tagline character varying,
          description text,
          "footerText" character varying,
          "supportText" character varying
      );


      --
      -- Name: tenant_roles; Type: TABLE; Schema: public; Owner: -
      --

      CREATE TABLE tenant_roles (
          "tenantId" character varying NOT NULL,
          "roleId" uuid NOT NULL
      );


      --
      -- Name: tenants; Type: TABLE; Schema: public; Owner: -
      --

      CREATE TABLE tenants (
          "hospitalId" character varying NOT NULL,
          "hospitalName" character varying NOT NULL,
          status character varying DEFAULT 'active'::character varying NOT NULL,
          "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
          "activatedAt" timestamp with time zone,
          "suspendedAt" timestamp with time zone,
          "createdBy" character varying,
          "packageCode" character varying DEFAULT 'basic'::character varying NOT NULL,
          "archivedAt" timestamp with time zone,
          "purgedAt" timestamp with time zone
      );


      --
      -- Name: department_catalog PK_department_catalog; Type: CONSTRAINT; Schema: public; Owner: -
      --

      ALTER TABLE ONLY department_catalog
          ADD CONSTRAINT "PK_department_catalog" PRIMARY KEY (id);


      --
      -- Name: tenant_roles PK_tenant_roles; Type: CONSTRAINT; Schema: public; Owner: -
      --

      ALTER TABLE ONLY tenant_roles
          ADD CONSTRAINT "PK_tenant_roles" PRIMARY KEY ("tenantId", "roleId");


      --
      -- Name: department_catalog UQ_department_catalog_departmentCode; Type: CONSTRAINT; Schema: public; Owner: -
      --

      ALTER TABLE ONLY department_catalog
          ADD CONSTRAINT "UQ_department_catalog_departmentCode" UNIQUE ("departmentCode");


      --
      -- Name: role_permissions UQ_role_permissions_role_permission; Type: CONSTRAINT; Schema: public; Owner: -
      --

      ALTER TABLE ONLY role_permissions
          ADD CONSTRAINT "UQ_role_permissions_role_permission" UNIQUE ("roleId", "permissionId");


      --
      -- Name: packages packages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
      --

      ALTER TABLE ONLY packages
          ADD CONSTRAINT packages_pkey PRIMARY KEY (code);


      --
      -- Name: permissions permissions_name_key; Type: CONSTRAINT; Schema: public; Owner: -
      --

      ALTER TABLE ONLY permissions
          ADD CONSTRAINT permissions_name_key UNIQUE (name);


      --
      -- Name: permissions permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
      --

      ALTER TABLE ONLY permissions
          ADD CONSTRAINT permissions_pkey PRIMARY KEY (id);


      --
      -- Name: role_permissions role_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
      --

      ALTER TABLE ONLY role_permissions
          ADD CONSTRAINT role_permissions_pkey PRIMARY KEY (id);


      --
      -- Name: roles roles_name_key; Type: CONSTRAINT; Schema: public; Owner: -
      --

      ALTER TABLE ONLY roles
          ADD CONSTRAINT roles_name_key UNIQUE (name);


      --
      -- Name: roles roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
      --

      ALTER TABLE ONLY roles
          ADD CONSTRAINT roles_pkey PRIMARY KEY (id);


      --
      -- Name: subscription_invoices subscription_invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
      --

      ALTER TABLE ONLY subscription_invoices
          ADD CONSTRAINT subscription_invoices_pkey PRIMARY KEY (id);


      --
      -- Name: subscriptions subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
      --

      ALTER TABLE ONLY subscriptions
          ADD CONSTRAINT subscriptions_pkey PRIMARY KEY (id);


      --
      -- Name: tenant_branding tenant_branding_pkey; Type: CONSTRAINT; Schema: public; Owner: -
      --

      ALTER TABLE ONLY tenant_branding
          ADD CONSTRAINT tenant_branding_pkey PRIMARY KEY ("tenantId");


      --
      -- Name: tenants tenants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
      --

      ALTER TABLE ONLY tenants
          ADD CONSTRAINT tenants_pkey PRIMARY KEY ("hospitalId");


      --
      -- Name: IDX_subscription_invoices_tenantId; Type: INDEX; Schema: public; Owner: -
      --

      CREATE INDEX "IDX_subscription_invoices_tenantId" ON subscription_invoices USING btree ("tenantId");


      --
      -- Name: IDX_subscriptions_tenantId; Type: INDEX; Schema: public; Owner: -
      --

      CREATE INDEX "IDX_subscriptions_tenantId" ON subscriptions USING btree ("tenantId");


      --
      -- Name: IDX_tenant_roles_roleId; Type: INDEX; Schema: public; Owner: -
      --

      CREATE INDEX "IDX_tenant_roles_roleId" ON tenant_roles USING btree ("roleId");


      --
      -- Name: UQ_subscription_invoices_number; Type: INDEX; Schema: public; Owner: -
      --

      CREATE UNIQUE INDEX "UQ_subscription_invoices_number" ON subscription_invoices USING btree ("invoiceNumber");


      --
      -- Name: UQ_subscription_invoices_period; Type: INDEX; Schema: public; Owner: -
      --

      CREATE UNIQUE INDEX "UQ_subscription_invoices_period" ON subscription_invoices USING btree ("subscriptionId", "periodStart");


      --
      -- Name: role_permissions role_permissions_permissionId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
      --

      ALTER TABLE ONLY role_permissions
          ADD CONSTRAINT "role_permissions_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES permissions(id);


      --
      -- Name: role_permissions role_permissions_roleId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
      --

      ALTER TABLE ONLY role_permissions
          ADD CONSTRAINT "role_permissions_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES roles(id);


      --
      -- Name: subscription_invoices subscription_invoices_subscriptionId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
      --

      ALTER TABLE ONLY subscription_invoices
          ADD CONSTRAINT "subscription_invoices_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES subscriptions(id) ON DELETE CASCADE;


      --
      -- Name: tenant_branding tenant_branding_tenantId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
      --

      ALTER TABLE ONLY tenant_branding
          ADD CONSTRAINT "tenant_branding_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES tenants("hospitalId") ON DELETE CASCADE;


      --
      -- Name: tenant_roles tenant_roles_roleId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
      --

      ALTER TABLE ONLY tenant_roles
          ADD CONSTRAINT "tenant_roles_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES roles(id) ON DELETE CASCADE;


      --
      -- Name: tenant_roles tenant_roles_tenantId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
      --

      ALTER TABLE ONLY tenant_roles
          ADD CONSTRAINT "tenant_roles_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES tenants("hospitalId") ON DELETE CASCADE;


      --
      -- Name: tenants tenants_packageCode_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
      --

      ALTER TABLE ONLY tenants
          ADD CONSTRAINT "tenants_packageCode_fkey" FOREIGN KEY ("packageCode") REFERENCES packages(code);


      --
      -- Name: SCHEMA public; Type: ACL; Schema: -; Owner: -
      --

      REVOKE USAGE ON SCHEMA public FROM PUBLIC;
      GRANT ALL ON SCHEMA public TO PUBLIC;


      --
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE IF EXISTS subscription_invoices, subscriptions, tenant_branding, packages,
        department_catalog, tenant_roles, role_permissions, permissions, roles, tenants CASCADE
    `);
  }
}
