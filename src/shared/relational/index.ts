/**
 * 사람이 적은 관계 모델 글 → IE → SQL. 계약은 ./userSchema.ts에 있다.
 * ERD에서 관계 모델을 자동으로 만들지 않는다. 글에 없는 것(타입 등)은 추측하지 않는다.
 */
export * from './userSchema';
export { parseRelational, parseMarkup, formatName, RELATIONAL_SYNTAX, RELATIONAL_SYNTAX_EXAMPLE } from './text';
export { toMarkup, fromMarkup } from './markup';
export { columnKey, cleanType, MAX_TYPE_LENGTH } from './settings';
export { deriveIe } from './ie';
export { layoutIe, ieBoxSize, ieColumnGrid, ieSectionHeight, ieOtherSectionHeight, IE_BOX, type IeColumnGrid } from './layout';
export { toSql, dialectType, quoteIdentifier, isSqlDialect, SQL_DIALECTS, TYPE_PLACEHOLDER } from './sql';
export { nameKey, cleanName } from './names';
export {
  getRelationalText,
  setRelationalText,
  readRelationalSource,
  setRelationalSource,
  readColumnSettings,
  setColumnSetting,
  getColumnSettingsMap,
  RELATIONAL_TEXT,
  RELATIONAL_COLUMNS,
  RELATIONAL_META,
  readRoomDialect,
  setRoomDialect,
  getIePositionsMap,
  readIePositions,
  setIePosition,
  deleteIePosition,
  IE_POSITIONS,
} from './ydoc';
export {
  planRenameColumn,
  planRenameTable,
  applyRelationalEdit,
  applyPlanToSource,
  checkNewName,
  type RelEditPlan,
  type RelEditOk,
  type RelEditError,
  type ForeignKeyTarget,
  type SettingsDrop,
} from './edit';
export { planAddTable, planDeleteTable, planAddColumn, type RelAddTablePlan, type RelAddColumnPlan } from './structure';
export {
  planTogglePrimaryKey,
  planSetKeys,
  planSetIdentifying,
  planRepairKeys,
  countRepairableKeys,
  planDeleteColumn,
  planAddRelationship,
  planDeleteRelationship,
  type RelAddRelationshipPlan,
} from './keys';
export {
  readIeDocument,
  ieDocumentOf,
  planIeDocument,
  applyIeDocument,
  MAX_IE_TABLES,
  MAX_IE_COLUMNS,
  MAX_IE_RELATIONSHIPS,
  MAX_IE_NAME_LENGTH,
  MAX_IE_COORDINATE,
  MAX_IE_TEXT_BYTES,
  type IeDocument,
  type IeDocTable,
  type IeDocColumn,
  type IeDocRelationship,
  type IeWritePlan,
  type IePlanResult,
} from './ieDocument';
