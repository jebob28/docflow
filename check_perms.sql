SELECT r.name as role, p.name as permission 
FROM role_permissions rp 
JOIN roles r ON rp.role_id = r.id 
JOIN permissions p ON rp.permission_id = p.id 
ORDER BY r.name;