# Pruebas de la base de datos

`mvp_rls.sql` se ejecuta en el SQL Editor de Supabase (o con el conector) **dentro de una transacción que nunca se confirma**: crea dos usuarios de prueba, juega como ellos y como visitante, y devuelve una tabla `check_name / ok`. Al terminar no queda nada guardado.

Última ejecución: 20 oct 2026 — 28/28 `ok = true`.
