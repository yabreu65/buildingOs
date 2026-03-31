"use strict";
/**
 * CommunicationsValidators: Scope and permission validation for Communications
 *
 * Ensures that:
 * 1. Communications belong to the user's tenant
 * 2. Buildings/Units referenced belong to the tenant
 * 3. Targets are valid for the tenant
 * 4. Cross-tenant access is prevented (always returns 404, never 403)
 */
var __esDecorate = (this && this.__esDecorate) || function (ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
    function accept(f) { if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected"); return f; }
    var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
    var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
    var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
    var _, done = false;
    for (var i = decorators.length - 1; i >= 0; i--) {
        var context = {};
        for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
        for (var p in contextIn.access) context.access[p] = contextIn.access[p];
        context.addInitializer = function (f) { if (done) throw new TypeError("Cannot add initializers after decoration has completed"); extraInitializers.push(accept(f || null)); };
        var result = (0, decorators[i])(kind === "accessor" ? { get: descriptor.get, set: descriptor.set } : descriptor[key], context);
        if (kind === "accessor") {
            if (result === void 0) continue;
            if (result === null || typeof result !== "object") throw new TypeError("Object expected");
            if (_ = accept(result.get)) descriptor.get = _;
            if (_ = accept(result.set)) descriptor.set = _;
            if (_ = accept(result.init)) initializers.unshift(_);
        }
        else if (_ = accept(result)) {
            if (kind === "field") initializers.unshift(_);
            else descriptor[key] = _;
        }
    }
    if (target) Object.defineProperty(target, contextIn.name, descriptor);
    done = true;
};
var __runInitializers = (this && this.__runInitializers) || function (thisArg, initializers, value) {
    var useValue = arguments.length > 2;
    for (var i = 0; i < initializers.length; i++) {
        value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
    }
    return useValue ? value : void 0;
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var __setFunctionName = (this && this.__setFunctionName) || function (f, name, prefix) {
    if (typeof name === "symbol") name = name.description ? "[".concat(name.description, "]") : "";
    return Object.defineProperty(f, "name", { configurable: true, value: prefix ? "".concat(prefix, " ", name) : name });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CommunicationsValidators = void 0;
var common_1 = require("@nestjs/common");
var CommunicationsValidators = function () {
    var _classDecorators = [(0, common_1.Injectable)()];
    var _classDescriptor;
    var _classExtraInitializers = [];
    var _classThis;
    var CommunicationsValidators = _classThis = /** @class */ (function () {
        function CommunicationsValidators_1(prisma) {
            this.prisma = prisma;
        }
        /**
         * Validate that a communication belongs to the tenant
         *
         * @throws NotFoundException if communication doesn't belong to tenant
         */
        CommunicationsValidators_1.prototype.validateCommunicationBelongsToTenant = function (tenantId, communicationId) {
            return __awaiter(this, void 0, void 0, function () {
                var communication;
                return __generator(this, function (_a) {
                    switch (_a.label) {
                        case 0: return [4 /*yield*/, this.prisma.communication.findFirst({
                                where: {
                                    id: communicationId,
                                    tenantId: tenantId,
                                },
                                select: { id: true },
                            })];
                        case 1:
                            communication = _a.sent();
                            if (!communication) {
                                throw new common_1.NotFoundException("Communication not found or does not belong to this tenant");
                            }
                            return [2 /*return*/];
                    }
                });
            });
        };
        /**
         * Validate that a communication belongs to both tenant and building
         *
         * @throws NotFoundException if communication doesn't belong to tenant/building
         */
        CommunicationsValidators_1.prototype.validateCommunicationBelongsToBuildingAndTenant = function (tenantId, buildingId, communicationId) {
            return __awaiter(this, void 0, void 0, function () {
                var communication;
                return __generator(this, function (_a) {
                    switch (_a.label) {
                        case 0: return [4 /*yield*/, this.prisma.communication.findFirst({
                                where: {
                                    id: communicationId,
                                    tenantId: tenantId,
                                    buildingId: buildingId,
                                },
                                select: { id: true },
                            })];
                        case 1:
                            communication = _a.sent();
                            if (!communication) {
                                throw new common_1.NotFoundException("Communication not found or does not belong to this tenant/building");
                            }
                            return [2 /*return*/];
                    }
                });
            });
        };
        /**
         * Validate that a building belongs to the tenant
         *
         * @throws NotFoundException if building doesn't belong to tenant
         */
        CommunicationsValidators_1.prototype.validateBuildingBelongsToTenant = function (tenantId, buildingId) {
            return __awaiter(this, void 0, void 0, function () {
                var building;
                return __generator(this, function (_a) {
                    switch (_a.label) {
                        case 0: return [4 /*yield*/, this.prisma.building.findFirst({
                                where: {
                                    id: buildingId,
                                    tenantId: tenantId,
                                },
                                select: { id: true },
                            })];
                        case 1:
                            building = _a.sent();
                            if (!building) {
                                throw new common_1.NotFoundException("Building not found or does not belong to this tenant");
                            }
                            return [2 /*return*/];
                    }
                });
            });
        };
        /**
         * Validate that a unit belongs to the tenant (indirectly via building)
         *
         * @throws NotFoundException if unit doesn't belong to tenant
         */
        CommunicationsValidators_1.prototype.validateUnitBelongsToTenant = function (tenantId, unitId) {
            return __awaiter(this, void 0, void 0, function () {
                var unit;
                return __generator(this, function (_a) {
                    switch (_a.label) {
                        case 0: return [4 /*yield*/, this.prisma.unit.findFirst({
                                where: {
                                    id: unitId,
                                    building: { tenantId: tenantId },
                                },
                                select: { id: true },
                            })];
                        case 1:
                            unit = _a.sent();
                            if (!unit) {
                                throw new common_1.NotFoundException("Unit not found or does not belong to this tenant");
                            }
                            return [2 /*return*/];
                    }
                });
            });
        };
        /**
         * Validate that a target is valid for the tenant and target type
         *
         * Rules:
         * - ALL_TENANT: targetId must be null
         * - BUILDING: targetId must be a building belonging to tenant
         * - UNIT: targetId must be a unit belonging to tenant
         * - ROLE: targetId must be a valid role code (RESIDENT, OWNER, etc)
         *
         * @throws BadRequestException if target is invalid
         * @throws NotFoundException if referenced resource doesn't belong to tenant
         */
        CommunicationsValidators_1.prototype.validateTarget = function (tenantId, targetType, targetId) {
            return __awaiter(this, void 0, void 0, function () {
                var _a, validRoles;
                return __generator(this, function (_b) {
                    switch (_b.label) {
                        case 0:
                            _a = targetType;
                            switch (_a) {
                                case 'ALL_TENANT': return [3 /*break*/, 1];
                                case 'BUILDING': return [3 /*break*/, 2];
                                case 'UNIT': return [3 /*break*/, 4];
                                case 'ROLE': return [3 /*break*/, 6];
                            }
                            return [3 /*break*/, 7];
                        case 1:
                            if (targetId !== null && targetId !== undefined && targetId !== '') {
                                throw new common_1.BadRequestException("ALL_TENANT target must have null targetId, got: \"".concat(targetId, "\""));
                            }
                            return [3 /*break*/, 8];
                        case 2:
                            if (!targetId) {
                                throw new common_1.BadRequestException("BUILDING target requires buildingId in targetId");
                            }
                            return [4 /*yield*/, this.validateBuildingBelongsToTenant(tenantId, targetId)];
                        case 3:
                            _b.sent();
                            return [3 /*break*/, 8];
                        case 4:
                            if (!targetId) {
                                throw new common_1.BadRequestException("UNIT target requires unitId in targetId");
                            }
                            return [4 /*yield*/, this.validateUnitBelongsToTenant(tenantId, targetId)];
                        case 5:
                            _b.sent();
                            return [3 /*break*/, 8];
                        case 6:
                            {
                                if (!targetId) {
                                    throw new common_1.BadRequestException("ROLE target requires role code in targetId");
                                }
                                validRoles = ['RESIDENT', 'OWNER', 'OPERATOR', 'TENANT_ADMIN', 'TENANT_OWNER', 'SUPER_ADMIN'];
                                if (!validRoles.includes(targetId.toUpperCase())) {
                                    throw new common_1.BadRequestException("Invalid role: \"".concat(targetId, "\". Valid roles: ").concat(validRoles.join(', ')));
                                }
                                return [3 /*break*/, 8];
                            }
                            _b.label = 7;
                        case 7: throw new common_1.BadRequestException("Unknown targetType: \"".concat(targetType, "\""));
                        case 8: return [2 /*return*/];
                    }
                });
            });
        };
        /**
         * Get all user IDs that should receive a communication
         * based on its targets
         *
         * @returns Array of userIds that match the targets
         */
        CommunicationsValidators_1.prototype.resolveRecipients = function (tenantId, communicationId) {
            return __awaiter(this, void 0, void 0, function () {
                var targets, recipientIds, _i, targets_1, target, userIds;
                return __generator(this, function (_a) {
                    switch (_a.label) {
                        case 0: return [4 /*yield*/, this.prisma.communicationTarget.findMany({
                                where: {
                                    communicationId: communicationId,
                                    tenantId: tenantId,
                                },
                                select: {
                                    targetType: true,
                                    targetId: true,
                                },
                            })];
                        case 1:
                            targets = _a.sent();
                            if (targets.length === 0) {
                                return [2 /*return*/, []];
                            }
                            recipientIds = new Set();
                            _i = 0, targets_1 = targets;
                            _a.label = 2;
                        case 2:
                            if (!(_i < targets_1.length)) return [3 /*break*/, 5];
                            target = targets_1[_i];
                            return [4 /*yield*/, this.resolveTarget(tenantId, target.targetType, target.targetId)];
                        case 3:
                            userIds = _a.sent();
                            userIds.forEach(function (id) { return recipientIds.add(id); });
                            _a.label = 4;
                        case 4:
                            _i++;
                            return [3 /*break*/, 2];
                        case 5: return [2 /*return*/, Array.from(recipientIds)];
                    }
                });
            });
        };
        /**
         * Resolve a single target to its list of user IDs
         *
         * @private
         */
        CommunicationsValidators_1.prototype.resolveTarget = function (tenantId, targetType, targetId) {
            return __awaiter(this, void 0, void 0, function () {
                var _a, tenantUsers, buildingOccupants, unitOccupants, roleUsers;
                return __generator(this, function (_b) {
                    switch (_b.label) {
                        case 0:
                            _a = targetType;
                            switch (_a) {
                                case 'ALL_TENANT': return [3 /*break*/, 1];
                                case 'BUILDING': return [3 /*break*/, 3];
                                case 'UNIT': return [3 /*break*/, 5];
                                case 'ROLE': return [3 /*break*/, 7];
                            }
                            return [3 /*break*/, 9];
                        case 1: return [4 /*yield*/, this.prisma.user.findMany({
                                where: {
                                    memberships: {
                                        some: {
                                            tenantId: tenantId,
                                        },
                                    },
                                },
                                select: { id: true },
                            })];
                        case 2:
                            tenantUsers = _b.sent();
                            return [2 /*return*/, tenantUsers.map(function (u) { return u.id; })];
                        case 3: return [4 /*yield*/, this.prisma.unitOccupant.findMany({
                                where: {
                                    unit: {
                                        building: {
                                            id: targetId,
                                            tenantId: tenantId,
                                        },
                                    },
                                },
                                include: { member: { select: { userId: true } } },
                                distinct: ['memberId'],
                            })];
                        case 4:
                            buildingOccupants = _b.sent();
                            return [2 /*return*/, buildingOccupants
                                    .filter(function (o) { return o.member.userId; })
                                    .map(function (o) { return o.member.userId; })];
                        case 5: return [4 /*yield*/, this.prisma.unitOccupant.findMany({
                                where: {
                                    unitId: targetId,
                                    unit: {
                                        building: { tenantId: tenantId },
                                    },
                                },
                                include: { member: { select: { userId: true } } },
                                distinct: ['memberId'],
                            })];
                        case 6:
                            unitOccupants = _b.sent();
                            return [2 /*return*/, unitOccupants
                                    .filter(function (o) { return o.member.userId; })
                                    .map(function (o) { return o.member.userId; })];
                        case 7: return [4 /*yield*/, this.prisma.user.findMany({
                                where: {
                                    memberships: {
                                        some: {
                                            tenantId: tenantId,
                                            roles: {
                                                some: {
                                                    role: targetId,
                                                },
                                            },
                                        },
                                    },
                                },
                                select: { id: true },
                            })];
                        case 8:
                            roleUsers = _b.sent();
                            return [2 /*return*/, roleUsers.map(function (u) { return u.id; })];
                        case 9: return [2 /*return*/, []];
                    }
                });
            });
        };
        /**
         * Check if a user can read a communication
         *
         * Rules:
         * - TENANT_ADMIN/OWNER/OPERATOR: can read all
         * - RESIDENT: can only read if they have a receipt for it
         *
         * @returns true if user can read, false otherwise
         */
        CommunicationsValidators_1.prototype.canUserReadCommunication = function (_tenantId, userId, communicationId, userRoles) {
            return __awaiter(this, void 0, void 0, function () {
                var adminRoles, receipt;
                return __generator(this, function (_a) {
                    switch (_a.label) {
                        case 0:
                            adminRoles = ['TENANT_ADMIN', 'TENANT_OWNER', 'OPERATOR'];
                            if (userRoles.some(function (r) { return adminRoles.includes(r); })) {
                                return [2 /*return*/, true];
                            }
                            return [4 /*yield*/, this.prisma.communicationReceipt.findUnique({
                                    where: {
                                        communicationId_userId: {
                                            communicationId: communicationId,
                                            userId: userId,
                                        },
                                    },
                                    select: { id: true },
                                })];
                        case 1:
                            receipt = _a.sent();
                            return [2 /*return*/, !!receipt];
                    }
                });
            });
        };
        return CommunicationsValidators_1;
    }());
    __setFunctionName(_classThis, "CommunicationsValidators");
    (function () {
        var _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(null) : void 0;
        __esDecorate(null, _classDescriptor = { value: _classThis }, _classDecorators, { kind: "class", name: _classThis.name, metadata: _metadata }, null, _classExtraInitializers);
        CommunicationsValidators = _classThis = _classDescriptor.value;
        if (_metadata) Object.defineProperty(_classThis, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        __runInitializers(_classThis, _classExtraInitializers);
    })();
    return CommunicationsValidators = _classThis;
}();
exports.CommunicationsValidators = CommunicationsValidators;
