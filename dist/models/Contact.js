import mongoose, { Schema, model } from 'mongoose';
const ContactSchema = new Schema({
    _id: { type: String, required: true },
    orgId: { type: String, required: true, index: true },
    accountId: { type: String, required: true, index: true },
    igsid: { type: String, required: true, index: true },
    username: { type: String, index: true },
    name: { type: String },
    avatarUrl: { type: String },
    email: { type: String, index: true },
    phone: { type: String },
    whatsapp: { type: String },
    locale: { type: String },
    timezone: { type: String },
    country: { type: String },
    fields: { type: Schema.Types.Mixed, default: {} },
    tags: [{ type: String }],
    isFollower: { type: Boolean, default: false },
    followerCheckedAt: { type: Date },
    followConfirmedAt: { type: Date },
    optedOut: { type: Boolean, default: false },
    optedOutAt: { type: Date },
    blocked: { type: Boolean, default: false },
    messagesSent: { type: Number, default: 0 },
    messagesReceived: { type: Number, default: 0 },
    linkClicks: { type: Number, default: 0 },
    triggersFired: { type: Number, default: 0 },
    firstSeenAt: { type: Date, default: Date.now },
    lastSeenAt: { type: Date, default: Date.now, index: true },
    lastInboundAt: { type: Date },
    lastOutboundAt: { type: Date },
}, {
    timestamps: true,
    _id: false,
    toJSON: {
        virtuals: true,
        transform: (_doc, ret) => {
            ret.id = ret._id;
            delete ret.__v;
            return ret;
        },
    },
});
ContactSchema.index({ accountId: 1, igsid: 1 }, { unique: true });
ContactSchema.index({ orgId: 1, lastSeenAt: -1 });
export const Contact = mongoose.models.Contact || model('Contact', ContactSchema);
