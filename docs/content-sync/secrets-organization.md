Para este caso usá `fine-grained personal access tokens` de GitHub. `Deploy keys` están pensadas para acceso SSH por repo; si un servidor necesita varios repos, GitHub indica que necesitás una key dedicada por repositorio, y además no te resuelven bien el `repository_dispatch`. Para más control fino, GitHub recomienda PATs finos o GitHub Apps. Fuentes: [deploy keys](https://docs.github.com/authentication/connecting-to-github-with-ssh/managing-deploy-keys), [fine-grained PATs](https://docs.github.com/en/enterprise-cloud@latest/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens).

**1. `CONTENT_SOURCE_READ_TOKEN`**
Esto sirve para que `musiki/framework` pueda leer `i1`, `i2`, `cym`, `s123` durante el build/sync.

Paso a paso:
1. En GitHub: foto de perfil > `Settings` > `Developer settings` > `Personal access tokens` > `Fine-grained tokens` > `Generate new token`.
2. `Token name`: `framework-content-read`.
3. `Resource owner`: `musiki`.
4. `Repository access`: `Only select repositories`.
5. Elegí: `i1`, `i2`, `cym`, `s123`.
6. En permisos de repositorio, poné sólo:
   - `Contents: Read`
7. Generá el token y copialo.

Dónde guardarlo:
1. Abrí `musiki/framework`.
2. `Settings` > `Secrets and variables` > `Actions` > `New repository secret`.
3. Nombre: `CONTENT_SOURCE_READ_TOKEN`
4. Valor: el token recién creado.

**2. `PLATFORM_DISPATCH_TOKEN`**
Esto sirve para que cada repo de materia dispare `repository_dispatch` hacia `musiki/framework`.

Paso a paso:
1. En GitHub: foto de perfil > `Settings` > `Developer settings` > `Personal access tokens` > `Fine-grained tokens` > `Generate new token`.
2. `Token name`: `framework-dispatch`.
3. `Resource owner`: `musiki`.
4. `Repository access`: `Only select repositories`.
5. Elegí sólo: `framework`.
6. En permisos de repositorio, poné:
   - `Contents: Write`
7. Generá el token y copialo.

Dónde guardarlo:
Opción recomendada, porque lo van a usar varios repos de materias:
1. Abrí la organización `musiki`.
2. `Settings` > `Secrets and variables` > `Actions` > `New organization secret`.
3. Nombre: `PLATFORM_DISPATCH_TOKEN`
4. Valor: ese token.
5. `Repository access`: `Selected repositories`
6. Elegí: `i1`, luego `i2`, `cym`, `s123`.

Si preferís, también podés guardarlo como `repository secret` dentro de `musiki/i1`, pero como lo vas a repetir en varias materias, `organization secret` es mejor.

**3. Si GitHub pide aprobación**
Si la org exige aprobación para fine-grained PATs, un owner debe aprobarlos en:
`Organizations` > `musiki` > `Settings` > `Personal access tokens` > `Pending requests`.
Fuente: [approvals de fine-grained PATs](https://docs.github.com/en/organizations/managing-programmatic-access-to-your-organization/managing-requests-for-personal-access-tokens-in-your-organization)

**4. Qué permiso exacto pide cada uno**
- `CONTENT_SOURCE_READ_TOKEN`: `Contents: Read`
- `PLATFORM_DISPATCH_TOKEN`: `Contents: Write`

Lo de `repository_dispatch` con `Contents: Write` está documentado acá: [Create a repository dispatch event](https://docs.github.com/en/rest/repos/repos?list-repository-teams=#create-a-repository-dispatch-event)

Si querés, el próximo paso te lo dejo operativo con checklist exacto repo por repo:
- qué secreto poner en `framework`
- qué secreto poner a nivel org
- y después los comandos de `git remote add origin` y `git push -u origin main` para `framework` e `i1`.