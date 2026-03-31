"use strict";
/**
 * CommunicationsService: CRUD operations for Communications with scope validation
 *
 * All methods validate that resources belong to the tenant.
 * No cross-tenant access is possible, even with guessed IDs.
 */
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
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
exports.CommunicationsService = void 0;
var common_1 = require("@nestjs/common");
var admin_role_guard_1 = require("./admin-role.guard");
/** Include spec shared by all queries that return full communication details */
var COMMUNICATION_INCLUDE = {
    targets: true,
    receipts: {
        include: {
            user: { select: { id: true, name: true, email: true } },
        },
    },
    createdByMembership: {
        include: {
            user: { select: { id: true, name: true, email: true } },
        },
    },
};
var CommunicationsService = function () {
    var _classDecorators = [(0, common_1.Injectable)()];
    var _classDescriptor;
    var _classExtraInitializers = [];
    var _classThis;
    var CommunicationsService = _classThis = /** @class */ (function () {
        function CommunicationsService_1(prisma, validators, configService) {
            this.prisma = prisma;
            this.validators = validators;
            this.configService = configService;
        }
        /**
         * Create a new communication (DRAFT status)
         *
         * Validates:
         * - Building (if provided) belongs to tenant
         * - All targets are valid for tenant
         *
         * Creates:
         * - Communication with DRAFT status
         * - CommunicationTarget entries
         * - CommunicationReceipt entries (one per recipient)
         *
         * @throws NotFoundException if building/target doesn't belong to tenant
         * @throws BadRequestException if input is invalid
         */
        CommunicationsService_1.prototype.create = function (tenantId, userId, input) {
            return __awaiter(this, void 0, void 0, function () {
                var membership, createdByMembershipId, _i, _a, target, communication, recipientIds;
                return __generator(this, function (_b) {
                    switch (_b.label) {
                        case 0: return [4 /*yield*/, this.prisma.membership.findFirst({
                                where: { userId: userId, tenantId: tenantId },
                                select: { id: true },
                            })];
                        case 1:
                            membership = _b.sent();
                            if (!membership) {
                                throw new common_1.BadRequestException('User does not have a membership in this tenant');
                            }
                            createdByMembershipId = membership.id;
                            if (!input.buildingId) return [3 /*break*/, 3];
                            return [4 /*yield*/, this.validators.validateBuildingBelongsToTenant(tenantId, input.buildingId)];
                        case 2:
                            _b.sent();
                            _b.label = 3;
                        case 3:
                            // 2. Validate all targets
                            if (!input.targets || input.targets.length === 0) {
                                throw new common_1.BadRequestException('Communication must have at least one target');
                            }
                            _i = 0, _a = input.targets;
                            _b.label = 4;
                        case 4:
                            if (!(_i < _a.length)) return [3 /*break*/, 7];
                            target = _a[_i];
                            return [4 /*yield*/, this.validators.validateTarget(tenantId, target.targetType, target.targetId || null)];
                        case 5:
                            _b.sent();
                            _b.label = 6;
                        case 6:
                            _i++;
                            return [3 /*break*/, 4];
                        case 7: return [4 /*yield*/, this.prisma.communication.create({
                                data: {
                                    tenantId: tenantId,
                                    buildingId: input.buildingId || null,
                                    title: input.title,
                                    body: input.body,
                                    channel: input.channel,
                                    status: 'DRAFT',
                                    createdByMembershipId: createdByMembershipId,
                                    // Create targets
                                    targets: {
                                        createMany: {
                                            data: input.targets.map(function (t) { return ({
                                                tenantId: tenantId,
                                                targetType: t.targetType,
                                                targetId: t.targetId || null,
                                            }); }),
                                        },
                                    },
                                },
                                include: {
                                    targets: true,
                                },
                            })];
                        case 8:
                            communication = _b.sent();
                            return [4 /*yield*/, this.validators.resolveRecipients(tenantId, communication.id)];
                        case 9:
                            recipientIds = _b.sent();
                            if (!(recipientIds.length > 0)) return [3 /*break*/, 11];
                            return [4 /*yield*/, this.prisma.communicationReceipt.createMany({
                                    data: recipientIds.map(function (recipientUserId) { return ({
                                        tenantId: tenantId,
                                        communicationId: communication.id,
                                        userId: recipientUserId,
                                    }); }),
                                    skipDuplicates: true, // If user is in multiple targets
                                })];
                        case 10:
                            _b.sent();
                            _b.label = 11;
                        case 11: return [2 /*return*/, this.findOne(tenantId, communication.id)];
                    }
                });
            });
        };
        /**
         * Get all communications in a tenant (or building if filtered)
         *
         * @throws NotFoundException if building doesn't belong to tenant
         */
        CommunicationsService_1.prototype.findAll = function (tenantId, filters) {
            return __awaiter(this, void 0, void 0, function () {
                var whereBase, sortField, sortOrder;
                var _a;
                var _b, _c;
                return __generator(this, function (_d) {
                    switch (_d.label) {
                        case 0:
                            if (!(filters === null || filters === void 0 ? void 0 : filters.buildingId)) return [3 /*break*/, 2];
                            return [4 /*yield*/, this.validators.validateBuildingBelongsToTenant(tenantId, filters.buildingId)];
                        case 1:
                            _d.sent();
                            _d.label = 2;
                        case 2:
                            whereBase = __assign(__assign(__assign(__assign({ tenantId: tenantId, deletedAt: null }, ((filters === null || filters === void 0 ? void 0 : filters.buildingId) ? { buildingId: filters.buildingId } : {})), ((filters === null || filters === void 0 ? void 0 : filters.status) ? { status: filters.status } : {})), ((filters === null || filters === void 0 ? void 0 : filters.channel) ? { channel: filters.channel } : {})), ((filters === null || filters === void 0 ? void 0 : filters.search) ? {
                                OR: [
                                    { title: { contains: filters.search, mode: 'insensitive' } },
                                    { body: { contains: filters.search, mode: 'insensitive' } },
                                ],
                            } : {}));
                            sortField = (_b = filters === null || filters === void 0 ? void 0 : filters.sortBy) !== null && _b !== void 0 ? _b : 'createdAt';
                            sortOrder = (_c = filters === null || filters === void 0 ? void 0 : filters.sortOrder) !== null && _c !== void 0 ? _c : 'desc';
                            return [4 /*yield*/, this.prisma.communication.findMany({
                                    where: whereBase,
                                    include: COMMUNICATION_INCLUDE,
                                    orderBy: (_a = {}, _a[sortField] = sortOrder, _a),
                                })];
                        case 3: return [2 /*return*/, _d.sent()];
                    }
                });
            });
        };
        /**
         * Get a single communication with all details
         *
         * @throws NotFoundException if communication doesn't belong to tenant
         */
        CommunicationsService_1.prototype.findOne = function (tenantId, communicationId) {
            return __awaiter(this, void 0, void 0, function () {
                var communication;
                return __generator(this, function (_a) {
                    switch (_a.label) {
                        case 0: return [4 /*yield*/, this.validators.validateCommunicationBelongsToTenant(tenantId, communicationId)];
                        case 1:
                            _a.sent();
                            return [4 /*yield*/, this.prisma.communication.findUnique({
                                    where: { id: communicationId },
                                    include: COMMUNICATION_INCLUDE,
                                })];
                        case 2:
                            communication = _a.sent();
                            if (!communication) {
                                throw new common_1.NotFoundException("Communication not found");
                            }
                            return [2 /*return*/, communication];
                    }
                });
            });
        };
        /**
         * Update a communication (only DRAFT status)
         *
         * @throws NotFoundException if communication doesn't belong to tenant
         * @throws BadRequestException if communication is not DRAFT
         */
        CommunicationsService_1.prototype.update = function (tenantId, communicationId, input) {
            return __awaiter(this, void 0, void 0, function () {
                var communication;
                return __generator(this, function (_a) {
                    switch (_a.label) {
                        case 0: 
                        // Validate scope
                        return [4 /*yield*/, this.validators.validateCommunicationBelongsToTenant(tenantId, communicationId)];
                        case 1:
                            // Validate scope
                            _a.sent();
                            return [4 /*yield*/, this.prisma.communication.findUnique({
                                    where: { id: communicationId },
                                    select: { status: true },
                                })];
                        case 2:
                            communication = _a.sent();
                            if (!communication) {
                                throw new common_1.NotFoundException("Communication not found");
                            }
                            if (communication.status !== 'DRAFT') {
                                throw new common_1.BadRequestException("Can only update DRAFT communications. Current status: ".concat(communication.status));
                            }
                            return [4 /*yield*/, this.prisma.communication.update({
                                    where: { id: communicationId },
                                    data: {
                                        title: input.title,
                                        body: input.body,
                                        channel: input.channel,
                                        updatedAt: new Date(),
                                    },
                                    include: COMMUNICATION_INCLUDE,
                                })];
                        case 3: return [2 /*return*/, _a.sent()];
                    }
                });
            });
        };
        /**
         * Schedule a communication (DRAFT → SCHEDULED)
         *
         * @throws NotFoundException if communication doesn't belong to tenant
         * @throws BadRequestException if communication is not DRAFT
         */
        CommunicationsService_1.prototype.schedule = function (tenantId, communicationId, input) {
            return __awaiter(this, void 0, void 0, function () {
                var communication;
                return __generator(this, function (_a) {
                    switch (_a.label) {
                        case 0: 
                        // Validate scope
                        return [4 /*yield*/, this.validators.validateCommunicationBelongsToTenant(tenantId, communicationId)];
                        case 1:
                            // Validate scope
                            _a.sent();
                            return [4 /*yield*/, this.prisma.communication.findUnique({
                                    where: { id: communicationId },
                                    select: { status: true },
                                })];
                        case 2:
                            communication = _a.sent();
                            if (!communication) {
                                throw new common_1.NotFoundException("Communication not found");
                            }
                            if (communication.status !== 'DRAFT') {
                                throw new common_1.BadRequestException("Can only schedule DRAFT communications. Current status: ".concat(communication.status));
                            }
                            // Validate scheduledAt is in the future
                            if (input.scheduledAt <= new Date()) {
                                throw new common_1.BadRequestException("scheduledAt must be in the future");
                            }
                            return [4 /*yield*/, this.prisma.communication.update({
                                    where: { id: communicationId },
                                    data: {
                                        status: 'SCHEDULED',
                                        scheduledAt: input.scheduledAt,
                                        updatedAt: new Date(),
                                    },
                                    include: COMMUNICATION_INCLUDE,
                                })];
                        case 3: return [2 /*return*/, _a.sent()];
                    }
                });
            });
        };
        /**
         * Send a communication (any status → SENT)
         *
         * In production, this would integrate with notification channels
         * For MVP, just updates the status and sentAt timestamp
         *
          * @throws NotFoundException if communication doesn't belong to tenant
          */
        CommunicationsService_1.prototype.send = function (tenantId, communicationId) {
            return __awaiter(this, void 0, void 0, function () {
                return __generator(this, function (_a) {
                    switch (_a.label) {
                        case 0: 
                        // Validate scope
                        return [4 /*yield*/, this.validators.validateCommunicationBelongsToTenant(tenantId, communicationId)];
                        case 1:
                            // Validate scope
                            _a.sent();
                            return [4 /*yield*/, this.prisma.communication.update({
                                    where: { id: communicationId },
                                    data: {
                                        status: 'SENT',
                                        sentAt: new Date(),
                                        updatedAt: new Date(),
                                    },
                                    include: COMMUNICATION_INCLUDE,
                                })];
                        case 2: return [2 /*return*/, _a.sent()];
                    }
                });
            });
        };
        /**
         * Publish a communication with optional web push
         *
         * Anti-spam rule:
         * - If sendWebPush=true and feature flag enforceUrgentForWebPush is enabled,
         *   only allows priority=URGENT
         *
         * @throws NotFoundException if communication doesn't belong to tenant
         * @throws BadRequestException if sendWebPush=true but priority!=URGENT (when flag enabled)
         */
        CommunicationsService_1.prototype.publish = function (tenantId, communicationId, sendWebPush) {
            return __awaiter(this, void 0, void 0, function () {
                var communication, enforceUrgent, published;
                return __generator(this, function (_a) {
                    switch (_a.label) {
                        case 0: 
                        // Validate scope
                        return [4 /*yield*/, this.validators.validateCommunicationBelongsToTenant(tenantId, communicationId)];
                        case 1:
                            // Validate scope
                            _a.sent();
                            return [4 /*yield*/, this.prisma.communication.findUnique({
                                    where: { id: communicationId },
                                    select: { priority: true, status: true },
                                })];
                        case 2:
                            communication = _a.sent();
                            if (!communication) {
                                throw new common_1.NotFoundException('Communication not found');
                            }
                            enforceUrgent = this.configService.isFeatureEnabled('enforceUrgentForWebPush');
                            if (sendWebPush && enforceUrgent && communication.priority !== 'URGENT') {
                                throw new common_1.BadRequestException({
                                    code: 'WEB_PUSH_REQUIRES_URGENT',
                                    message: 'Web push can only be sent for URGENT communications',
                                });
                            }
                            return [4 /*yield*/, this.prisma.communication.update({
                                    where: { id: communicationId },
                                    data: {
                                        status: 'SENT',
                                        sentAt: new Date(),
                                        updatedAt: new Date(),
                                    },
                                    include: COMMUNICATION_INCLUDE,
                                })];
                        case 3:
                            published = _a.sent();
                            // TODO: Send web push to subscribed users (best-effort, non-blocking)
                            // This would integrate with push subscriptions when implemented
                            return [2 /*return*/, published];
                    }
                });
            });
        };
        /**
         * Delete a communication (only DRAFT status)
         *
         * Cascade delete: targets + receipts deleted automatically
         *
         * @throws NotFoundException if communication doesn't belong to tenant
         * @throws BadRequestException if communication is not DRAFT
         */
        CommunicationsService_1.prototype.delete = function (tenantId, communicationId) {
            return __awaiter(this, void 0, void 0, function () {
                var communication;
                return __generator(this, function (_a) {
                    switch (_a.label) {
                        case 0: 
                        // Validate scope
                        return [4 /*yield*/, this.validators.validateCommunicationBelongsToTenant(tenantId, communicationId)];
                        case 1:
                            // Validate scope
                            _a.sent();
                            return [4 /*yield*/, this.prisma.communication.findUnique({
                                    where: { id: communicationId },
                                    select: { status: true },
                                })];
                        case 2:
                            communication = _a.sent();
                            if (!communication) {
                                throw new common_1.NotFoundException("Communication not found");
                            }
                            if (communication.status !== 'DRAFT') {
                                throw new common_1.BadRequestException("Can only delete DRAFT communications. Current status: ".concat(communication.status));
                            }
                            return [4 /*yield*/, this.prisma.communication.update({
                                    where: { id: communicationId },
                                    data: { deletedAt: new Date() },
                                    include: COMMUNICATION_INCLUDE,
                                })];
                        case 3: 
                        // Soft delete: preserve record and receipt history
                        return [2 /*return*/, _a.sent()];
                    }
                });
            });
        };
        /**
         * Get communications for a user (respecting their receipt status)
         *
         * RESIDENT users can only see communications they received
         * Admin users can see all communications
         *
         * @param userRoles Roles of the user making the request
         */
        CommunicationsService_1.prototype.findForUser = function (tenantId, userId, userRoles, filters) {
            return __awaiter(this, void 0, void 0, function () {
                var isAdmin, whereBase, sortField, sortOrder;
                var _a;
                var _b, _c;
                return __generator(this, function (_d) {
                    switch (_d.label) {
                        case 0:
                            if (!(filters === null || filters === void 0 ? void 0 : filters.buildingId)) return [3 /*break*/, 2];
                            return [4 /*yield*/, this.validators.validateBuildingBelongsToTenant(tenantId, filters.buildingId)];
                        case 1:
                            _d.sent();
                            _d.label = 2;
                        case 2:
                            isAdmin = userRoles.some(function (r) { return admin_role_guard_1.ADMIN_ROLES.includes(r); });
                            if (!isAdmin) return [3 /*break*/, 3];
                            // Admin sees all communications
                            return [2 /*return*/, this.findAll(tenantId, {
                                    buildingId: filters === null || filters === void 0 ? void 0 : filters.buildingId,
                                    status: filters === null || filters === void 0 ? void 0 : filters.status,
                                    channel: filters === null || filters === void 0 ? void 0 : filters.channel,
                                    search: filters === null || filters === void 0 ? void 0 : filters.search,
                                    sortBy: filters === null || filters === void 0 ? void 0 : filters.sortBy,
                                    sortOrder: filters === null || filters === void 0 ? void 0 : filters.sortOrder,
                                })];
                        case 3:
                            whereBase = __assign(__assign(__assign(__assign({ tenantId: tenantId, deletedAt: null, receipts: {
                                    some: __assign({ userId: userId }, ((filters === null || filters === void 0 ? void 0 : filters.readOnly) ? { readAt: { not: null } } : {})),
                                } }, ((filters === null || filters === void 0 ? void 0 : filters.buildingId) ? { buildingId: filters.buildingId } : {})), ((filters === null || filters === void 0 ? void 0 : filters.status) ? { status: filters.status } : {})), ((filters === null || filters === void 0 ? void 0 : filters.channel) ? { channel: filters.channel } : {})), ((filters === null || filters === void 0 ? void 0 : filters.search) ? {
                                OR: [
                                    { title: { contains: filters.search, mode: 'insensitive' } },
                                    { body: { contains: filters.search, mode: 'insensitive' } },
                                ],
                            } : {}));
                            sortField = (_b = filters === null || filters === void 0 ? void 0 : filters.sortBy) !== null && _b !== void 0 ? _b : 'createdAt';
                            sortOrder = (_c = filters === null || filters === void 0 ? void 0 : filters.sortOrder) !== null && _c !== void 0 ? _c : 'desc';
                            return [4 /*yield*/, this.prisma.communication.findMany({
                                    where: whereBase,
                                    include: __assign(__assign({}, COMMUNICATION_INCLUDE), { receipts: {
                                            where: { userId: userId },
                                            include: {
                                                user: { select: { id: true, name: true, email: true } },
                                            },
                                        } }),
                                    orderBy: (_a = {}, _a[sortField] = sortOrder, _a),
                                })];
                        case 4: return [2 /*return*/, _d.sent()];
                    }
                });
            });
        };
        /**
         * Mark a communication as read by a user
         *
         * Returns { count: 0 } silently if no matching receipt found
         */
        CommunicationsService_1.prototype.markAsRead = function (tenantId, userId, communicationId) {
            return __awaiter(this, void 0, void 0, function () {
                return __generator(this, function (_a) {
                    switch (_a.label) {
                        case 0: return [4 /*yield*/, this.prisma.communicationReceipt.updateMany({
                                where: {
                                    communicationId: communicationId,
                                    userId: userId,
                                    tenantId: tenantId,
                                },
                                data: {
                                    readAt: new Date(),
                                },
                            })];
                        case 1: return [2 /*return*/, _a.sent()];
                    }
                });
            });
        };
        /**
         * Mark a communication as delivered to a user
         *
         * Returns { count: 0 } silently if no matching receipt found
         */
        CommunicationsService_1.prototype.markAsDelivered = function (tenantId, userId, communicationId) {
            return __awaiter(this, void 0, void 0, function () {
                return __generator(this, function (_a) {
                    switch (_a.label) {
                        case 0: return [4 /*yield*/, this.prisma.communicationReceipt.updateMany({
                                where: {
                                    communicationId: communicationId,
                                    userId: userId,
                                    tenantId: tenantId,
                                },
                                data: {
                                    deliveredAt: new Date(),
                                },
                            })];
                        case 1: return [2 /*return*/, _a.sent()];
                    }
                });
            });
        };
        /**
         * Resident communication list item (for cursor pagination)
         */
        CommunicationsService_1.prototype.findForResident = function (tenantId_1, userId_1) {
            return __awaiter(this, arguments, void 0, function (tenantId, userId, limit, cursor) {
                var cursorDate, cursorId, decoded, baseWhere, receipts, hasMore, items, mappedItems, nextCursor, lastItem;
                if (limit === void 0) { limit = 20; }
                return __generator(this, function (_a) {
                    switch (_a.label) {
                        case 0:
                            if (cursor) {
                                try {
                                    decoded = JSON.parse(Buffer.from(cursor, 'base64').toString());
                                    cursorDate = decoded.publishedAt ? new Date(decoded.publishedAt) : undefined;
                                    cursorId = decoded.id;
                                }
                                catch (_b) {
                                    // Invalid cursor, ignore
                                }
                            }
                            baseWhere = {
                                tenantId: tenantId,
                                userId: userId,
                                communication: {
                                    status: 'SENT',
                                    sentAt: { not: null },
                                },
                            };
                            if (!(cursorDate && cursorId)) return [3 /*break*/, 2];
                            return [4 /*yield*/, this.prisma.communicationReceipt.findMany({
                                    where: __assign(__assign({}, baseWhere), { OR: [
                                            { communication: { sentAt: { lt: cursorDate } } },
                                            { AND: [
                                                    { communication: { sentAt: cursorDate } },
                                                    { communication: { id: { lt: cursorId } } },
                                                ] },
                                        ] }),
                                    include: {
                                        communication: {
                                            include: {
                                                targets: { select: { targetId: true, targetType: true } },
                                            },
                                        },
                                    },
                                    orderBy: [
                                        { communication: { sentAt: 'desc' } },
                                        { communication: { id: 'desc' } },
                                    ],
                                    take: limit + 1,
                                })];
                        case 1:
                            receipts = _a.sent();
                            return [3 /*break*/, 4];
                        case 2: return [4 /*yield*/, this.prisma.communicationReceipt.findMany({
                                where: baseWhere,
                                include: {
                                    communication: {
                                        include: {
                                            targets: { select: { targetId: true, targetType: true } },
                                        },
                                    },
                                },
                                orderBy: [
                                    { communication: { sentAt: 'desc' } },
                                    { communication: { id: 'desc' } },
                                ],
                                take: limit + 1,
                            })];
                        case 3:
                            receipts = _a.sent();
                            _a.label = 4;
                        case 4:
                            hasMore = receipts.length > limit;
                            items = receipts.slice(0, limit);
                            mappedItems = items.map(function (receipt) {
                                var _a, _b, _c, _d;
                                var comm = receipt.communication;
                                var buildingIds = comm.targets
                                    .filter(function (t) { return t.targetType === 'BUILDING' && t.targetId; })
                                    .map(function (t) { return t.targetId; });
                                var scopeType = buildingIds.length === 0
                                    ? 'TENANT_ALL'
                                    : buildingIds.length === 1
                                        ? 'BUILDING'
                                        : 'MULTI_BUILDING';
                                return {
                                    id: comm.id,
                                    title: comm.title,
                                    body: comm.body,
                                    priority: (comm.priority || 'NORMAL'),
                                    scopeType: scopeType,
                                    buildingIds: buildingIds,
                                    createdAt: comm.createdAt.toISOString(),
                                    publishedAt: (_b = (_a = comm.sentAt) === null || _a === void 0 ? void 0 : _a.toISOString()) !== null && _b !== void 0 ? _b : undefined,
                                    deliveryStatus: (receipt.readAt ? 'READ' : 'UNREAD'),
                                    readAt: (_d = (_c = receipt.readAt) === null || _c === void 0 ? void 0 : _c.toISOString()) !== null && _d !== void 0 ? _d : undefined,
                                };
                            });
                            if (hasMore && mappedItems.length > 0) {
                                lastItem = mappedItems[mappedItems.length - 1];
                                nextCursor = Buffer.from(JSON.stringify({
                                    publishedAt: lastItem.publishedAt,
                                    id: lastItem.id,
                                })).toString('base64');
                            }
                            return [2 /*return*/, { items: mappedItems, nextCursor: nextCursor }];
                    }
                });
            });
        };
        /**
         * Mark as read idempotently for resident
         * Returns current read status
         */
        CommunicationsService_1.prototype.markAsReadForResident = function (tenantId, userId, communicationId) {
            return __awaiter(this, void 0, void 0, function () {
                var receipt;
                return __generator(this, function (_a) {
                    switch (_a.label) {
                        case 0: return [4 /*yield*/, this.prisma.communicationReceipt.findUnique({
                                where: {
                                    communicationId_userId: {
                                        communicationId: communicationId,
                                        userId: userId,
                                    },
                                },
                                select: { readAt: true },
                            })];
                        case 1:
                            receipt = _a.sent();
                            if (!receipt) {
                                throw new common_1.NotFoundException('Receipt not found');
                            }
                            // If already read, return current status
                            if (receipt.readAt) {
                                return [2 /*return*/, { readAt: receipt.readAt }];
                            }
                            // Mark as read
                            return [4 /*yield*/, this.prisma.communicationReceipt.update({
                                    where: {
                                        communicationId_userId: {
                                            communicationId: communicationId,
                                            userId: userId,
                                        },
                                    },
                                    data: { readAt: new Date() },
                                })];
                        case 2:
                            // Mark as read
                            _a.sent();
                            return [2 /*return*/, { readAt: new Date() }];
                    }
                });
            });
        };
        /**
         * Create a new communication V2 (with scopeType pattern)
         *
         * If status=PUBLISHED:
         * - Sets publishedAt=now() (mapped to sentAt internally)
         * - Creates communication_deliveries with UNREAD status
         * - sendWebPush defaults to false (no push from this endpoint)
         *
         * @throws NotFoundException if building/target doesn't belong to tenant
         * @throws BadRequestException if input is invalid
         */
        CommunicationsService_1.prototype.createV2 = function (tenantId_1, userId_1, input_1) {
            return __awaiter(this, arguments, void 0, function (tenantId, userId, input, sendWebPush) {
                var membership, createdByMembershipId, targets, _a, _i, _b, buildingId, shouldPublish, communication, recipientIds;
                if (sendWebPush === void 0) { sendWebPush = false; }
                return __generator(this, function (_c) {
                    switch (_c.label) {
                        case 0: return [4 /*yield*/, this.prisma.membership.findFirst({
                                where: { userId: userId, tenantId: tenantId },
                                select: { id: true },
                            })];
                        case 1:
                            membership = _c.sent();
                            if (!membership) {
                                throw new common_1.BadRequestException('User does not have a membership in this tenant');
                            }
                            createdByMembershipId = membership.id;
                            targets = [];
                            _a = input.scopeType;
                            switch (_a) {
                                case 'TENANT_ALL': return [3 /*break*/, 2];
                                case 'BUILDING': return [3 /*break*/, 3];
                                case 'MULTI_BUILDING': return [3 /*break*/, 5];
                            }
                            return [3 /*break*/, 10];
                        case 2:
                            targets = [{ targetType: 'ALL_TENANT' }];
                            return [3 /*break*/, 10];
                        case 3:
                            if (!input.buildingId) {
                                throw new common_1.BadRequestException('BUILDING scopeType requires buildingId');
                            }
                            return [4 /*yield*/, this.validators.validateBuildingBelongsToTenant(tenantId, input.buildingId)];
                        case 4:
                            _c.sent();
                            targets = [{ targetType: 'BUILDING', targetId: input.buildingId }];
                            return [3 /*break*/, 10];
                        case 5:
                            if (!input.buildingIds || input.buildingIds.length === 0) {
                                throw new common_1.BadRequestException('MULTI_BUILDING scopeType requires buildingIds array');
                            }
                            _i = 0, _b = input.buildingIds;
                            _c.label = 6;
                        case 6:
                            if (!(_i < _b.length)) return [3 /*break*/, 9];
                            buildingId = _b[_i];
                            return [4 /*yield*/, this.validators.validateBuildingBelongsToTenant(tenantId, buildingId)];
                        case 7:
                            _c.sent();
                            _c.label = 8;
                        case 8:
                            _i++;
                            return [3 /*break*/, 6];
                        case 9:
                            targets = input.buildingIds.map(function (buildingId) { return ({
                                targetType: 'BUILDING',
                                targetId: buildingId,
                            }); });
                            return [3 /*break*/, 10];
                        case 10:
                            shouldPublish = input.status === 'PUBLISHED';
                            return [4 /*yield*/, this.prisma.communication.create({
                                    data: {
                                        tenantId: tenantId,
                                        buildingId: input.scopeType === 'BUILDING' ? input.buildingId || null : null,
                                        title: input.title,
                                        body: input.body,
                                        channel: 'IN_APP',
                                        status: shouldPublish ? 'SENT' : 'DRAFT',
                                        priority: input.priority || 'NORMAL',
                                        sentAt: shouldPublish ? new Date() : null,
                                        createdByMembershipId: createdByMembershipId,
                                        targets: {
                                            createMany: {
                                                data: targets.map(function (t) { return ({
                                                    tenantId: tenantId,
                                                    targetType: t.targetType,
                                                    targetId: t.targetId || null,
                                                }); }),
                                            },
                                        },
                                    },
                                    include: {
                                        targets: true,
                                    },
                                })];
                        case 11:
                            communication = _c.sent();
                            return [4 /*yield*/, this.validators.resolveRecipients(tenantId, communication.id)];
                        case 12:
                            recipientIds = _c.sent();
                            if (!(recipientIds.length > 0)) return [3 /*break*/, 14];
                            return [4 /*yield*/, this.prisma.communicationReceipt.createMany({
                                    data: recipientIds.map(function (recipientUserId) { return ({
                                        tenantId: tenantId,
                                        communicationId: communication.id,
                                        userId: recipientUserId,
                                    }); }),
                                    skipDuplicates: true,
                                })];
                        case 13:
                            _c.sent();
                            _c.label = 14;
                        case 14: return [2 /*return*/, this.findOne(tenantId, communication.id)];
                    }
                });
            });
        };
        /**
         * Publish a communication V2 with optional web push
         *
         * Anti-spam rule:
         * - If sendWebPush=true and feature flag enforceUrgentForWebPush is enabled (default true),
         *   only allows priority=URGENT
         * - Returns 422 with code WEB_PUSH_REQUIRES_URGENT if violated
         *
         * If sendWebPush=true:
         * - Sends WEB_PUSH only to users with active PushSubscription
         * - If no subscriptions, does NOT fail (silent no-op)
         *
         * @throws NotFoundException if communication doesn't belong to tenant
         * @throws UnprocessableEntityException if sendWebPush=true but priority!=URGENT (when flag enabled)
         */
        CommunicationsService_1.prototype.publishV2 = function (tenantId, communicationId, sendWebPush) {
            return __awaiter(this, void 0, void 0, function () {
                var communication, enforceUrgent, published;
                return __generator(this, function (_a) {
                    switch (_a.label) {
                        case 0: return [4 /*yield*/, this.validators.validateCommunicationBelongsToTenant(tenantId, communicationId)];
                        case 1:
                            _a.sent();
                            return [4 /*yield*/, this.prisma.communication.findUnique({
                                    where: { id: communicationId },
                                    select: { priority: true, status: true },
                                })];
                        case 2:
                            communication = _a.sent();
                            if (!communication) {
                                throw new common_1.NotFoundException('Communication not found');
                            }
                            enforceUrgent = this.configService.isFeatureEnabled('enforceUrgentForWebPush');
                            if (sendWebPush && enforceUrgent && communication.priority !== 'URGENT') {
                                throw new common_1.UnprocessableEntityException({
                                    code: 'WEB_PUSH_REQUIRES_URGENT',
                                    message: 'Web push can only be sent for URGENT communications',
                                });
                            }
                            return [4 /*yield*/, this.prisma.communication.update({
                                    where: { id: communicationId },
                                    data: {
                                        status: 'SENT',
                                        sentAt: new Date(),
                                        updatedAt: new Date(),
                                    },
                                    include: COMMUNICATION_INCLUDE,
                                })];
                        case 3:
                            published = _a.sent();
                            if (!sendWebPush) return [3 /*break*/, 5];
                            return [4 /*yield*/, this.sendWebPushIfApplicable(tenantId, communicationId)];
                        case 4:
                            _a.sent();
                            _a.label = 5;
                        case 5: return [2 /*return*/, published];
                    }
                });
            });
        };
        /**
         * Send web push to users with active subscriptions
         * Best-effort: does NOT fail if no subscriptions exist
         */
        CommunicationsService_1.prototype.sendWebPushIfApplicable = function (tenantId, communicationId) {
            return __awaiter(this, void 0, void 0, function () {
                var subscriptions, communication;
                return __generator(this, function (_a) {
                    switch (_a.label) {
                        case 0: return [4 /*yield*/, this.prisma.pushSubscription.findMany({
                                where: {
                                    tenantId: tenantId,
                                    revokedAt: null,
                                },
                                select: {
                                    userId: true,
                                    endpoint: true,
                                    p256dh: true,
                                    auth: true,
                                },
                            })];
                        case 1:
                            subscriptions = _a.sent();
                            if (subscriptions.length === 0) {
                                return [2 /*return*/];
                            }
                            return [4 /*yield*/, this.prisma.communication.findUnique({
                                    where: { id: communicationId },
                                    select: { title: true, body: true },
                                })];
                        case 2:
                            communication = _a.sent();
                            if (!communication) {
                                return [2 /*return*/];
                            }
                            // TODO: Integrate with actual push notification service (FCM, WebPush, etc.)
                            // For now, this is a placeholder that logs what would be sent
                            console.log("[Push] Would send push to ".concat(subscriptions.length, " users:"), {
                                title: communication.title,
                                body: communication.body,
                                subscriptions: subscriptions.map(function (s) { return s.endpoint; }),
                            });
                            return [2 /*return*/];
                    }
                });
            });
        };
        /**
         * Find communications for resident with cursor pagination V2
         *
         * Ordering: publishedAt DESC, id DESC (mapped to sentAt DESC, id DESC internally)
         *
         * @returns ResidentCommunicationListResponse with typed items
         */
        CommunicationsService_1.prototype.findForResidentV2 = function (tenantId_1, userId_1) {
            return __awaiter(this, arguments, void 0, function (tenantId, userId, limit, cursor) {
                var cursorDate, cursorId, decoded, baseWhere, receipts, hasMore, items, mappedItems, nextCursor, lastItem;
                if (limit === void 0) { limit = 20; }
                return __generator(this, function (_a) {
                    switch (_a.label) {
                        case 0:
                            if (cursor) {
                                try {
                                    decoded = JSON.parse(Buffer.from(cursor, 'base64').toString());
                                    cursorDate = decoded.publishedAt ? new Date(decoded.publishedAt) : undefined;
                                    cursorId = decoded.id;
                                }
                                catch (_b) {
                                    // Invalid cursor, ignore
                                }
                            }
                            baseWhere = {
                                tenantId: tenantId,
                                userId: userId,
                                communication: {
                                    status: 'SENT',
                                    sentAt: { not: null },
                                },
                            };
                            if (!(cursorDate && cursorId)) return [3 /*break*/, 2];
                            return [4 /*yield*/, this.prisma.communicationReceipt.findMany({
                                    where: __assign(__assign({}, baseWhere), { OR: [
                                            { communication: { sentAt: { lt: cursorDate } } },
                                            {
                                                AND: [
                                                    { communication: { sentAt: cursorDate } },
                                                    { communication: { id: { lt: cursorId } } },
                                                ],
                                            },
                                        ] }),
                                    include: {
                                        communication: {
                                            include: {
                                                targets: { select: { targetId: true, targetType: true } },
                                            },
                                        },
                                    },
                                    orderBy: [
                                        { communication: { sentAt: 'desc' } },
                                        { communication: { id: 'desc' } },
                                    ],
                                    take: limit + 1,
                                })];
                        case 1:
                            receipts = _a.sent();
                            return [3 /*break*/, 4];
                        case 2: return [4 /*yield*/, this.prisma.communicationReceipt.findMany({
                                where: baseWhere,
                                include: {
                                    communication: {
                                        include: {
                                            targets: { select: { targetId: true, targetType: true } },
                                        },
                                    },
                                },
                                orderBy: [
                                    { communication: { sentAt: 'desc' } },
                                    { communication: { id: 'desc' } },
                                ],
                                take: limit + 1,
                            })];
                        case 3:
                            receipts = _a.sent();
                            _a.label = 4;
                        case 4:
                            hasMore = receipts.length > limit;
                            items = receipts.slice(0, limit);
                            mappedItems = items.map(function (receipt) {
                                var _a, _b, _c, _d;
                                var comm = receipt.communication;
                                var buildingIds = comm.targets
                                    .filter(function (t) { return t.targetType === 'BUILDING' && t.targetId; })
                                    .map(function (t) { return t.targetId; });
                                var scopeType = buildingIds.length === 0
                                    ? 'TENANT_ALL'
                                    : buildingIds.length === 1
                                        ? 'BUILDING'
                                        : 'MULTI_BUILDING';
                                return {
                                    id: comm.id,
                                    title: comm.title,
                                    body: comm.body,
                                    priority: (comm.priority || 'NORMAL'),
                                    scopeType: scopeType,
                                    buildingIds: buildingIds,
                                    createdAt: comm.createdAt.toISOString(),
                                    publishedAt: (_b = (_a = comm.sentAt) === null || _a === void 0 ? void 0 : _a.toISOString()) !== null && _b !== void 0 ? _b : null,
                                    deliveryStatus: receipt.readAt ? 'READ' : 'UNREAD',
                                    readAt: (_d = (_c = receipt.readAt) === null || _c === void 0 ? void 0 : _c.toISOString()) !== null && _d !== void 0 ? _d : null,
                                };
                            });
                            if (hasMore && mappedItems.length > 0) {
                                lastItem = mappedItems[mappedItems.length - 1];
                                nextCursor = Buffer.from(JSON.stringify({
                                    publishedAt: lastItem.publishedAt,
                                    id: lastItem.id,
                                })).toString('base64');
                            }
                            return [2 /*return*/, { items: mappedItems, nextCursor: nextCursor }];
                    }
                });
            });
        };
        return CommunicationsService_1;
    }());
    __setFunctionName(_classThis, "CommunicationsService");
    (function () {
        var _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(null) : void 0;
        __esDecorate(null, _classDescriptor = { value: _classThis }, _classDecorators, { kind: "class", name: _classThis.name, metadata: _metadata }, null, _classExtraInitializers);
        CommunicationsService = _classThis = _classDescriptor.value;
        if (_metadata) Object.defineProperty(_classThis, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        __runInitializers(_classThis, _classExtraInitializers);
    })();
    return CommunicationsService = _classThis;
}();
exports.CommunicationsService = CommunicationsService;
