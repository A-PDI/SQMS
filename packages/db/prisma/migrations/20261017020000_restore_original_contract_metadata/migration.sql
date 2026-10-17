-- Reconstruct newly modeled presentation fields from the retained, credential-free
-- source snapshots when upgrading a target imported by the first implementation.
-- Existing operational edits and values are never overwritten.
UPDATE `nonconformances` AS n
JOIN `legacy_records` AS l ON l.`targetId` = n.`id` AND l.`entity` = 'ncrs' AND l.`targetType` = 'NCR'
SET n.`qmsFields` = l.`snapshot`
WHERE n.`qmsFields` IS NULL;

UPDATE `users` AS u
JOIN `legacy_records` AS l ON l.`targetId` = u.`id` AND l.`entity` = 'users' AND l.`targetType` = 'USER'
SET u.`legacyPermissions` = CASE
  WHEN JSON_TYPE(JSON_EXTRACT(l.`snapshot`, '$.permissions')) = 'OBJECT'
    THEN JSON_EXTRACT(l.`snapshot`, '$.permissions')
  WHEN JSON_TYPE(JSON_EXTRACT(l.`snapshot`, '$.permissions')) = 'STRING'
    AND JSON_VALID(JSON_UNQUOTE(JSON_EXTRACT(l.`snapshot`, '$.permissions')))
    THEN CAST(JSON_UNQUOTE(JSON_EXTRACT(l.`snapshot`, '$.permissions')) AS JSON)
  ELSE NULL END
WHERE u.`legacyPermissions` IS NULL AND JSON_EXTRACT(l.`snapshot`, '$.permissions') IS NOT NULL;

UPDATE `record_attachments` AS a
JOIN `legacy_records` AS l ON l.`targetId` = a.`fileObjectId` AND l.`entity` = 'engineering_drawings' AND l.`targetType` = 'FILE'
SET a.`context` = JSON_SET(COALESCE(a.`context`, JSON_OBJECT()),
  '$.kind', 'QMS_DRAWING',
  '$.version', JSON_UNQUOTE(JSON_EXTRACT(l.`snapshot`, '$.version')),
  '$.is_current', JSON_EXTRACT(l.`snapshot`, '$.is_current'),
  '$.originalPartNumber', JSON_UNQUOTE(JSON_EXTRACT(l.`snapshot`, '$.part_number')))
WHERE a.`entityType` = 'INTERNAL_PART' AND JSON_EXTRACT(a.`context`, '$.kind') IS NULL;
