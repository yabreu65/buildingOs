"use strict";
var __runInitializers = (this && this.__runInitializers) || function (thisArg, initializers, value) {
    var useValue = arguments.length > 2;
    for (var i = 0; i < initializers.length; i++) {
        value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
    }
    return useValue ? value : void 0;
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
exports.CommunicationsInboxController = exports.CommunicationsUserController = void 0;
var common_1 = require("@nestjs/common");
var jwt_auth_guard_1 = require("../auth/jwt-auth.guard");
var contracts_1 = require("@buildingos/contracts");
/**
 * CommunicationsUserController: Tenant-level and user-level Communications endpoints
 *
 * Routes:
 * - GET /communications - List all communications (tenant, admin only)
 * - GET /communications/:communicationId - Get detail (admin only)
 * - GET /me/communications - Inbox for current user
 * - POST /me/communications/:communicationId/read - Mark as read
 *
 * Security:
 * 1. JwtAuthGuard: Requires valid JWT token
 * 2. X-Tenant-Id header: Required for admin routes, auto-extracted for /me
 * 3. Service validates scope (communication belongs to tenant)
 * 4. /me routes: User can only access their own communications
 *
 * Permissions:
 * - /communications: Admin only (communications.read required)
 * - /me/communications: Any authenticated user
 */
var CommunicationsUserController = function () {
    var _classDecorators = [(0, common_1.Controller)('communications'), (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard)];
    var _classDescriptor;
    var _classExtraInitializers = [];
    var _classThis;
    var _instanceExtraInitializers = [];
    var _listCommunications_decorators;
    var _getCommunication_decorators;
    var _createCommunication_decorators;
    var _publishCommunication_decorators;
    var CommunicationsUserController = _classThis = /** @class */ (function () {
        function CommunicationsUserController_1(communicationsService, validators) {
            this.communicationsService = (__runInitializers(this, _instanceExtraInitializers), communicationsService);
            this.validators = validators;
        }
        /**
         * Check if user has admin roles
         */
        CommunicationsUserController_1.prototype.isAdminRole = function (userRoles) {
            var adminRoles = ['TENANT_ADMIN', 'TENANT_OWNER', 'OPERATOR'];
            return (userRoles === null || userRoles === void 0 ? void 0 : userRoles.some(function (r) { return adminRoles.includes(r); })) || false;
        };
        /**
         * GET /communications
         * List all communications in tenant (admin only)
         *
         * Query filters:
         * - buildingId: filter by building
         * - status: DRAFT | SCHEDULED | SENT
         *
         * Returns:
         * - Admin: All communications in tenant
         *
         * Requires: communications.read + admin role + X-Tenant-Id header
         */
        CommunicationsUserController_1.prototype.listCommunications = function (buildingId, status, req) {
            return __awaiter(this, void 0, void 0, function () {
                var xTenantId, userMemberships, membership, tenantId, userRoles, filters;
                var _a;
                return __generator(this, function (_b) {
                    switch (_b.label) {
                        case 0:
                            xTenantId = req.headers['x-tenant-id'];
                            if (!xTenantId) {
                                throw new common_1.BadRequestException('X-Tenant-Id header is required');
                            }
                            userMemberships = ((_a = req.user) === null || _a === void 0 ? void 0 : _a.memberships) || [];
                            membership = userMemberships.find(function (m) { return m.tenantId === xTenantId; });
                            if (!membership) {
                                throw new common_1.BadRequestException('User does not have membership in the specified tenant');
                            }
                            tenantId = xTenantId;
                            userRoles = membership.roles || [];
                            if (!this.isAdminRole(userRoles)) {
                                throw new common_1.BadRequestException('Only administrators can list communications');
                            }
                            filters = {};
                            if (!buildingId) return [3 /*break*/, 2];
                            // Validate building belongs to tenant
                            return [4 /*yield*/, this.validators.validateBuildingBelongsToTenant(tenantId, buildingId)];
                        case 1:
                            // Validate building belongs to tenant
                            _b.sent();
                            filters.buildingId = buildingId;
                            _b.label = 2;
                        case 2:
                            if (status)
                                filters.status = status;
                            return [4 /*yield*/, this.communicationsService.findAll(tenantId, filters)];
                        case 3: return [2 /*return*/, _b.sent()];
                    }
                });
            });
        };
        /**
         * GET /communications/:communicationId
         * Get communication detail (admin only)
         *
         * Returns full communication with targets and receipts
         *
         * Throws 404 if communication doesn't belong to tenant
         *
         * Requires: communications.read + admin role + X-Tenant-Id header
         */
        CommunicationsUserController_1.prototype.getCommunication = function (communicationId, req) {
            return __awaiter(this, void 0, void 0, function () {
                var xTenantId, userMemberships, membership, tenantId, userRoles;
                var _a;
                return __generator(this, function (_b) {
                    switch (_b.label) {
                        case 0:
                            xTenantId = req.headers['x-tenant-id'];
                            if (!xTenantId) {
                                throw new common_1.BadRequestException('X-Tenant-Id header is required');
                            }
                            userMemberships = ((_a = req.user) === null || _a === void 0 ? void 0 : _a.memberships) || [];
                            membership = userMemberships.find(function (m) { return m.tenantId === xTenantId; });
                            if (!membership) {
                                throw new common_1.BadRequestException('User does not have membership in the specified tenant');
                            }
                            tenantId = xTenantId;
                            userRoles = membership.roles || [];
                            if (!this.isAdminRole(userRoles)) {
                                throw new common_1.BadRequestException('Only administrators can view communications');
                            }
                            // Validate scope
                            return [4 /*yield*/, this.validators.validateCommunicationBelongsToTenant(tenantId, communicationId)];
                        case 1:
                            // Validate scope
                            _b.sent();
                            return [4 /*yield*/, this.communicationsService.findOne(tenantId, communicationId)];
                        case 2: return [2 /*return*/, _b.sent()];
                    }
                });
            });
        };
        /**
         * POST /communications
         * Create a new communication (admin only)
         *
         * Body: CreateCommunicationRequest (discriminatedUnion by scopeType)
         * - title, body, status, priority, scopeType
         * - scopeType BUILDING: requires buildingId
         * - scopeType MULTI_BUILDING: requires buildingIds array
         * - scopeType TENANT_ALL: no additional fields
         *
         * If status=PUBLISHED:
         * - Sets publishedAt=now() (mapped to sentAt internally)
         * - Creates communication_deliveries with UNREAD status
         * - sendWebPush defaults to false (no push from this endpoint)
         *
         * Requires: admin role + X-Tenant-Id header
         */
        CommunicationsUserController_1.prototype.createCommunication = function (rawBody, req) {
            return __awaiter(this, void 0, void 0, function () {
                var xTenantId, userMemberships, membership, tenantId, userRoles, parsed, input, userId;
                var _a;
                return __generator(this, function (_b) {
                    switch (_b.label) {
                        case 0:
                            xTenantId = req.headers['x-tenant-id'];
                            if (!xTenantId) {
                                throw new common_1.BadRequestException('X-Tenant-Id header is required');
                            }
                            userMemberships = ((_a = req.user) === null || _a === void 0 ? void 0 : _a.memberships) || [];
                            membership = userMemberships.find(function (m) { return m.tenantId === xTenantId; });
                            if (!membership) {
                                throw new common_1.BadRequestException('User does not have membership in the specified tenant');
                            }
                            tenantId = xTenantId;
                            userRoles = membership.roles || [];
                            if (!this.isAdminRole(userRoles)) {
                                throw new common_1.BadRequestException('Only administrators can create communications');
                            }
                            parsed = contracts_1.CreateCommunicationRequestSchema.safeParse(rawBody);
                            if (!parsed.success) {
                                throw new common_1.BadRequestException({
                                    message: 'Invalid request body',
                                    errors: parsed.error.flatten().fieldErrors,
                                });
                            }
                            input = parsed.data;
                            userId = req.user.id;
                            return [4 /*yield*/, this.communicationsService.createV2(tenantId, userId, {
                                    title: input.title,
                                    body: input.body,
                                    status: input.status,
                                    priority: input.priority,
                                    scopeType: input.scopeType,
                                    buildingId: input.scopeType === 'BUILDING' ? input.buildingId : undefined,
                                    buildingIds: input.scopeType === 'MULTI_BUILDING' ? input.buildingIds : undefined,
                                }, false)];
                        case 1: return [2 /*return*/, _b.sent()];
                    }
                });
            });
        };
        /**
         * POST /communications/:communicationId/publish
         * Publish a communication with optional web push
         *
         * Body: { sendWebPush: boolean }
         *
         * Anti-spam rule (behind feature flag enforceUrgentForWebPush, default true):
         * - If sendWebPush=true, priority must be URGENT
         * - Returns 422 with code WEB_PUSH_REQUIRES_URGENT if violated
         *
         * If sendWebPush=true:
         * - Sends WEB_PUSH only to users with active PushSubscription
         * - If no subscriptions, does NOT fail (silent no-op)
         *
         * Requires: admin role + X-Tenant-Id header
         */
        CommunicationsUserController_1.prototype.publishCommunication = function (communicationId, rawBody, req) {
            return __awaiter(this, void 0, void 0, function () {
                var xTenantId, userMemberships, membership, tenantId, userRoles, parsed, sendWebPush;
                var _a;
                return __generator(this, function (_b) {
                    switch (_b.label) {
                        case 0:
                            xTenantId = req.headers['x-tenant-id'];
                            if (!xTenantId) {
                                throw new common_1.BadRequestException('X-Tenant-Id header is required');
                            }
                            userMemberships = ((_a = req.user) === null || _a === void 0 ? void 0 : _a.memberships) || [];
                            membership = userMemberships.find(function (m) { return m.tenantId === xTenantId; });
                            if (!membership) {
                                throw new common_1.BadRequestException('User does not have membership in the specified tenant');
                            }
                            tenantId = xTenantId;
                            userRoles = membership.roles || [];
                            if (!this.isAdminRole(userRoles)) {
                                throw new common_1.BadRequestException('Only administrators can publish communications');
                            }
                            parsed = contracts_1.PublishCommunicationRequestSchema.safeParse(rawBody);
                            if (!parsed.success) {
                                throw new common_1.BadRequestException({
                                    message: 'Invalid request body',
                                    errors: parsed.error.flatten().fieldErrors,
                                });
                            }
                            sendWebPush = parsed.data.sendWebPush;
                            return [4 /*yield*/, this.communicationsService.publishV2(tenantId, communicationId, sendWebPush)];
                        case 1: return [2 /*return*/, _b.sent()];
                    }
                });
            });
        };
        return CommunicationsUserController_1;
    }());
    __setFunctionName(_classThis, "CommunicationsUserController");
    (function () {
        var _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(null) : void 0;
        _listCommunications_decorators = [(0, common_1.Get)()];
        _getCommunication_decorators = [(0, common_1.Get)(':communicationId')];
        _createCommunication_decorators = [(0, common_1.Post)()];
        _publishCommunication_decorators = [(0, common_1.Post)(':communicationId/publish')];
        __esDecorate(_classThis, null, _listCommunications_decorators, { kind: "method", name: "listCommunications", static: false, private: false, access: { has: function (obj) { return "listCommunications" in obj; }, get: function (obj) { return obj.listCommunications; } }, metadata: _metadata }, null, _instanceExtraInitializers);
        __esDecorate(_classThis, null, _getCommunication_decorators, { kind: "method", name: "getCommunication", static: false, private: false, access: { has: function (obj) { return "getCommunication" in obj; }, get: function (obj) { return obj.getCommunication; } }, metadata: _metadata }, null, _instanceExtraInitializers);
        __esDecorate(_classThis, null, _createCommunication_decorators, { kind: "method", name: "createCommunication", static: false, private: false, access: { has: function (obj) { return "createCommunication" in obj; }, get: function (obj) { return obj.createCommunication; } }, metadata: _metadata }, null, _instanceExtraInitializers);
        __esDecorate(_classThis, null, _publishCommunication_decorators, { kind: "method", name: "publishCommunication", static: false, private: false, access: { has: function (obj) { return "publishCommunication" in obj; }, get: function (obj) { return obj.publishCommunication; } }, metadata: _metadata }, null, _instanceExtraInitializers);
        __esDecorate(null, _classDescriptor = { value: _classThis }, _classDecorators, { kind: "class", name: _classThis.name, metadata: _metadata }, null, _classExtraInitializers);
        CommunicationsUserController = _classThis = _classDescriptor.value;
        if (_metadata) Object.defineProperty(_classThis, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        __runInitializers(_classThis, _classExtraInitializers);
    })();
    return CommunicationsUserController = _classThis;
}();
exports.CommunicationsUserController = CommunicationsUserController;
/**
 * CommunicationsInboxController: User inbox routes (/me/communications)
 *
 * Routes:
 * - GET /me/communications - List communications for current user
 * - POST /me/communications/:communicationId/read - Mark communication as read
 *
 * Security:
 * 1. JwtAuthGuard: Requires valid JWT
 * 2. No X-Tenant-Id header needed (uses user's tenant from JWT)
 * 3. User can only see/interact with communications targeted to them
 *
 * RESIDENT Workflow:
 * - User views their inbox (only communications with receipt)
 * - User opens communication to read details
 * - User marks as read
 */
var CommunicationsInboxController = function () {
    var _classDecorators = [(0, common_1.Controller)('me/communications'), (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard)];
    var _classDescriptor;
    var _classExtraInitializers = [];
    var _classThis;
    var _instanceExtraInitializers = [];
    var _getInbox_decorators;
    var _getCommunicationDetail_decorators;
    var _markAsRead_decorators;
    var _getResidentCommunications_decorators;
    var _markResidentAsRead_decorators;
    var CommunicationsInboxController = _classThis = /** @class */ (function () {
        function CommunicationsInboxController_1(communicationsService, validators) {
            this.communicationsService = (__runInitializers(this, _instanceExtraInitializers), communicationsService);
            this.validators = validators;
        }
        /**
         * GET /me/communications
         * List communications in user's inbox
         *
         * Query filters:
         * - buildingId: filter by building (optional)
         * - unitId: filter by unit (optional)
         * - readOnly: show only unread (false) or read (true) (optional)
         *
         * Returns:
         * - Only communications targeted to current user (have receipt)
         * - Includes receipt details (deliveredAt, readAt)
         *
         * No permission required (authenticated users only)
         */
        CommunicationsInboxController_1.prototype.getInbox = function (buildingId, unitId, readOnly, req) {
            return __awaiter(this, void 0, void 0, function () {
                var userMemberships, tenantId, userId, userRoles, filters;
                var _a;
                return __generator(this, function (_b) {
                    switch (_b.label) {
                        case 0:
                            userMemberships = ((_a = req.user) === null || _a === void 0 ? void 0 : _a.memberships) || [];
                            if (userMemberships.length === 0) {
                                throw new common_1.BadRequestException('User does not have a tenant membership');
                            }
                            tenantId = userMemberships[0].tenantId;
                            userId = req.user.id;
                            userRoles = userMemberships[0].roles || [];
                            filters = {};
                            if (!buildingId) return [3 /*break*/, 2];
                            return [4 /*yield*/, this.validators.validateBuildingBelongsToTenant(tenantId, buildingId)];
                        case 1:
                            _b.sent();
                            filters.buildingId = buildingId;
                            _b.label = 2;
                        case 2:
                            // For now, unitId filter is accepted but not validated (UX feature)
                            // In production, validate unit belongs to tenant if needed
                            if (unitId) {
                                filters.unitId = unitId;
                            }
                            if (readOnly) {
                                filters.readOnly = readOnly === 'true';
                            }
                            return [4 /*yield*/, this.communicationsService.findForUser(tenantId, userId, userRoles, filters)];
                        case 3: 
                        // Service returns only communications where user has receipt
                        return [2 /*return*/, _b.sent()];
                    }
                });
            });
        };
        /**
         * GET /me/communications/:communicationId
         * Get communication detail for current user
         *
         * Returns communication only if user received it (has receipt)
         * Includes their receipt status (deliveredAt, readAt)
         *
         * Throws 404 if:
         * - Communication doesn't exist
         * - User didn't receive it (no receipt)
         *
         * No permission required (authenticated users only)
         */
        CommunicationsInboxController_1.prototype.getCommunicationDetail = function (communicationId, req) {
            return __awaiter(this, void 0, void 0, function () {
                var userMemberships, tenantId, userId, userRoles, canRead;
                var _a;
                return __generator(this, function (_b) {
                    switch (_b.label) {
                        case 0:
                            userMemberships = ((_a = req.user) === null || _a === void 0 ? void 0 : _a.memberships) || [];
                            if (userMemberships.length === 0) {
                                throw new common_1.BadRequestException('User does not have a tenant membership');
                            }
                            tenantId = userMemberships[0].tenantId;
                            userId = req.user.id;
                            userRoles = userMemberships[0].roles || [];
                            // Validate communication belongs to tenant
                            return [4 /*yield*/, this.validators.validateCommunicationBelongsToTenant(tenantId, communicationId)];
                        case 1:
                            // Validate communication belongs to tenant
                            _b.sent();
                            return [4 /*yield*/, this.validators.canUserReadCommunication(tenantId, userId, communicationId, userRoles)];
                        case 2:
                            canRead = _b.sent();
                            if (!canRead) {
                                throw new common_1.BadRequestException('Communication not found or you do not have access to it');
                            }
                            return [4 /*yield*/, this.communicationsService.findOne(tenantId, communicationId)];
                        case 3: return [2 /*return*/, _b.sent()];
                    }
                });
            });
        };
        /**
         * POST /me/communications/:communicationId/read
         * Mark communication as read
         *
         * Updates receipt.readAt = now
         * Idempotent: if already read, no change
         *
         * Returns: { success: true, readAt: timestamp }
         *
         * Throws 404 if:
         * - Communication doesn't exist
         * - User didn't receive it (no receipt)
         *
         * No permission required (authenticated users only)
         */
        CommunicationsInboxController_1.prototype.markAsRead = function (communicationId, req) {
            return __awaiter(this, void 0, void 0, function () {
                var userMemberships, tenantId, userId, userRoles, canRead;
                var _a;
                return __generator(this, function (_b) {
                    switch (_b.label) {
                        case 0:
                            userMemberships = ((_a = req.user) === null || _a === void 0 ? void 0 : _a.memberships) || [];
                            if (userMemberships.length === 0) {
                                throw new common_1.BadRequestException('User does not have a tenant membership');
                            }
                            tenantId = userMemberships[0].tenantId;
                            userId = req.user.id;
                            userRoles = userMemberships[0].roles || [];
                            // Validate communication belongs to tenant
                            return [4 /*yield*/, this.validators.validateCommunicationBelongsToTenant(tenantId, communicationId)];
                        case 1:
                            // Validate communication belongs to tenant
                            _b.sent();
                            return [4 /*yield*/, this.validators.canUserReadCommunication(tenantId, userId, communicationId, userRoles)];
                        case 2:
                            canRead = _b.sent();
                            if (!canRead) {
                                throw new common_1.BadRequestException('Communication not found or you do not have access to it');
                            }
                            // Mark as read
                            return [4 /*yield*/, this.communicationsService.markAsRead(tenantId, userId, communicationId)];
                        case 3:
                            // Mark as read
                            _b.sent();
                            return [2 /*return*/, {
                                    success: true,
                                    communicationId: communicationId,
                                    readAt: new Date(),
                                }];
                    }
                });
            });
        };
        /**
         * GET /resident/communications
         * Resident inbox with cursor pagination
         *
         * Query params:
         * - limit: number (default 20, max 100)
         * - cursor: opaque cursor string (base64 encoded)
         *
         * Returns: { items: [...], nextCursor?: string }
         *
         * Ordering: publishedAt DESC, id DESC (mapped to sentAt internally)
         *
         * No permission required (authenticated users only)
         */
        CommunicationsInboxController_1.prototype.getResidentCommunications = function (rawQuery, req) {
            return __awaiter(this, void 0, void 0, function () {
                var userMemberships, parsedQuery, _a, limit, cursor, tenantId, userId;
                var _b;
                return __generator(this, function (_c) {
                    switch (_c.label) {
                        case 0:
                            userMemberships = (_b = req.user) === null || _b === void 0 ? void 0 : _b.memberships;
                            if (!userMemberships || userMemberships.length === 0) {
                                throw new common_1.BadRequestException('User does not have a tenant membership');
                            }
                            parsedQuery = contracts_1.ResidentCommunicationsQuerySchema.safeParse(rawQuery);
                            if (!parsedQuery.success) {
                                throw new common_1.BadRequestException({
                                    message: 'Invalid query parameters',
                                    errors: parsedQuery.error.flatten().fieldErrors,
                                });
                            }
                            _a = parsedQuery.data, limit = _a.limit, cursor = _a.cursor;
                            tenantId = userMemberships[0].tenantId;
                            userId = req.user.id;
                            return [4 /*yield*/, this.communicationsService.findForResidentV2(tenantId, userId, limit, cursor)];
                        case 1: return [2 /*return*/, _c.sent()];
                    }
                });
            });
        };
        /**
         * POST /resident/communications/:communicationId/read
         * Mark communication as read (idempotent)
         *
         * Returns: { readAt: Date | null }
         *
         * No permission required (authenticated users only)
         */
        CommunicationsInboxController_1.prototype.markResidentAsRead = function (communicationId, req) {
            return __awaiter(this, void 0, void 0, function () {
                var userMemberships, tenantId, userId;
                var _a;
                return __generator(this, function (_b) {
                    switch (_b.label) {
                        case 0:
                            userMemberships = ((_a = req.user) === null || _a === void 0 ? void 0 : _a.memberships) || [];
                            if (userMemberships.length === 0) {
                                throw new common_1.BadRequestException('User does not have a tenant membership');
                            }
                            tenantId = userMemberships[0].tenantId;
                            userId = req.user.id;
                            // Validate communication belongs to tenant
                            return [4 /*yield*/, this.validators.validateCommunicationBelongsToTenant(tenantId, communicationId)];
                        case 1:
                            // Validate communication belongs to tenant
                            _b.sent();
                            return [4 /*yield*/, this.communicationsService.markAsReadForResident(tenantId, userId, communicationId)];
                        case 2: return [2 /*return*/, _b.sent()];
                    }
                });
            });
        };
        return CommunicationsInboxController_1;
    }());
    __setFunctionName(_classThis, "CommunicationsInboxController");
    (function () {
        var _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(null) : void 0;
        _getInbox_decorators = [(0, common_1.Get)()];
        _getCommunicationDetail_decorators = [(0, common_1.Get)(':communicationId')];
        _markAsRead_decorators = [(0, common_1.Post)(':communicationId/read'), (0, common_1.HttpCode)(200)];
        _getResidentCommunications_decorators = [(0, common_1.Get)('resident/communications')];
        _markResidentAsRead_decorators = [(0, common_1.Post)('resident/communications/:communicationId/read')];
        __esDecorate(_classThis, null, _getInbox_decorators, { kind: "method", name: "getInbox", static: false, private: false, access: { has: function (obj) { return "getInbox" in obj; }, get: function (obj) { return obj.getInbox; } }, metadata: _metadata }, null, _instanceExtraInitializers);
        __esDecorate(_classThis, null, _getCommunicationDetail_decorators, { kind: "method", name: "getCommunicationDetail", static: false, private: false, access: { has: function (obj) { return "getCommunicationDetail" in obj; }, get: function (obj) { return obj.getCommunicationDetail; } }, metadata: _metadata }, null, _instanceExtraInitializers);
        __esDecorate(_classThis, null, _markAsRead_decorators, { kind: "method", name: "markAsRead", static: false, private: false, access: { has: function (obj) { return "markAsRead" in obj; }, get: function (obj) { return obj.markAsRead; } }, metadata: _metadata }, null, _instanceExtraInitializers);
        __esDecorate(_classThis, null, _getResidentCommunications_decorators, { kind: "method", name: "getResidentCommunications", static: false, private: false, access: { has: function (obj) { return "getResidentCommunications" in obj; }, get: function (obj) { return obj.getResidentCommunications; } }, metadata: _metadata }, null, _instanceExtraInitializers);
        __esDecorate(_classThis, null, _markResidentAsRead_decorators, { kind: "method", name: "markResidentAsRead", static: false, private: false, access: { has: function (obj) { return "markResidentAsRead" in obj; }, get: function (obj) { return obj.markResidentAsRead; } }, metadata: _metadata }, null, _instanceExtraInitializers);
        __esDecorate(null, _classDescriptor = { value: _classThis }, _classDecorators, { kind: "class", name: _classThis.name, metadata: _metadata }, null, _classExtraInitializers);
        CommunicationsInboxController = _classThis = _classDescriptor.value;
        if (_metadata) Object.defineProperty(_classThis, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        __runInitializers(_classThis, _classExtraInitializers);
    })();
    return CommunicationsInboxController = _classThis;
}();
exports.CommunicationsInboxController = CommunicationsInboxController;
