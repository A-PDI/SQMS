# MySQL for the Render Blueprint (render.yaml). Build context: repository root.
# The schema and least-privilege accounts are created on first start by infra/mysql/init, exactly as in Compose.
FROM mysql:8.4.11
COPY infra/mysql/init/ /docker-entrypoint-initdb.d/
COPY infra/mysql/conf/sqms.cnf /etc/mysql/conf.d/sqms.cnf
COPY infra/render/mysql.cnf /etc/mysql/conf.d/zz-render.cnf
