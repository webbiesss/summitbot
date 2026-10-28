const {
    SlashCommandBuilder,
    EmbedBuilder
} = require('discord.js');
const { getRoleId } = require('../utils/config');
const staffConfig = require('../staff/config');

const viewerRoleIds = Array.isArray(staffConfig.roles.viewers)
    ? staffConfig.roles.viewers.filter(Boolean)
    : [staffConfig.roles.viewers].filter(Boolean);

const commandCatalog = [
    {
        category: 'QOTD',
        name: '/qotdadd',
        description: 'Add a new Question of the Day to the queue.',
        requires: 'staff',
        requiresLabel: 'Staff role'
    },
    {
        category: 'QOTD',
        name: '/qotdlist',
        description: 'View the next 10 queued Questions of the Day.',
        requires: 'staff',
        requiresLabel: 'Staff role'
    },
    {
        category: 'QOTD',
        name: '/qotdstop',
        description: 'Pause automatic QOTD posting.',
        requires: 'staff',
        requiresLabel: 'Staff role'
    },
    {
        category: 'QOTD',
        name: '/qotdresume',
        description: 'Resume automatic QOTD posting.',
        requires: 'staff',
        requiresLabel: 'Staff role'
    },
    {
        category: 'QOTD',
        name: '/qotdnow',
        description: 'Post the next QOTD immediately.',
        requires: 'staff',
        requiresLabel: 'Staff role'
    },
    {
        category: 'QOTD',
        name: '/qotdremove',
        description: 'Remove a manually queued QOTD.',
        requires: 'staff',
        requiresLabel: 'Staff role'
    },
    {
        category: 'Guide & Roblox',
        name: '/stampupdate',
        description: 'Update a climber’s summit stamp progress and role tier.',
        requires: 'guide',
        requiresLabel: 'Guide role'
    },
    {
        category: 'Guide & Roblox',
        name: '/robloxstamplist',
        description: 'List tracked Roblox stamp entries.',
        requires: 'guide',
        requiresLabel: 'Guide role'
    },
    {
        category: 'Guide & Roblox',
        name: '/robloxstampupdate',
        description: 'Update a Roblox user’s stamp total.',
        requires: 'guide',
        requiresLabel: 'Guide role'
    },
    {
        category: 'Guide & Roblox',
        name: '/robloxstampview',
        description: 'View a Roblox user’s stamp total and details.',
        requires: 'guide',
        requiresLabel: 'Guide role'
    },
    {
        category: 'Guide & Roblox',
        name: '/robloxuseradd',
        description: 'Add a Roblox user to the tracking system.',
        requires: 'guide',
        requiresLabel: 'Guide role'
    },
    {
        category: 'Guide & Roblox',
        name: '/robloxuserremove',
        description: 'Remove a Roblox user from the tracking system.',
        requires: 'guide',
        requiresLabel: 'Guide role'
    },
    {
        category: 'Guide & Roblox',
        name: '/transferrobloxuser',
        description: 'Transfer a Roblox user and their stamp records.',
        requires: 'guide',
        requiresLabel: 'Guide role'
    },
    {
        category: 'Staff Quota',
        name: '/guidequota',
        description: 'Record Guide expedition activity and payouts.',
        requires: 'quotaManager',
        requiresLabel: 'Quota manager'
    },
    {
        category: 'Staff Quota',
        name: '/guidequotas',
        description: 'View the full Guide quota list.',
        requires: 'viewer',
        requiresLabel: 'Viewer access'
    },
    {
        category: 'Staff Quota',
        name: '/sarquota',
        description: 'Record S&R rescue activity and payouts.',
        requires: 'quotaManager',
        requiresLabel: 'Quota manager'
    },
    {
        category: 'Staff Quota',
        name: '/sarquotalist',
        description: 'View the full S&R quota list.',
        requires: 'viewer',
        requiresLabel: 'Viewer access'
    },
    {
        category: 'Staff Quota',
        name: '/staffdepartment',
        description: 'Enroll or remove a staff member from a department.',
        requires: 'quotaManager',
        requiresLabel: 'Quota manager'
    },
    {
        category: 'Staff Quota',
        name: '/staffquotaadjust',
        description: 'Manually adjust quota totals with an audit reason.',
        requires: 'quotaManager',
        requiresLabel: 'Quota manager'
    },
    {
        category: 'Staff Quota',
        name: '/staffprofile',
        description: 'View a staff member’s profile, quota, warnings, and balances.',
        requires: 'staff',
        requiresLabel: 'Staff role'
    },
    {
        category: 'Staff Quota',
        name: '/staffwarnings',
        description: 'View current Guide or S&R warnings.',
        requires: 'viewer',
        requiresLabel: 'Viewer access'
    },
    {
        category: 'Staff Quota',
        name: '/staffwarningedit',
        description: 'Adjust warning totals for a staff member.',
        requires: 'quotaManager',
        requiresLabel: 'Quota manager'
    },
    {
        category: 'Staff Quota',
        name: '/inactivityadd',
        description: 'Create a notice excusing staff from quota warnings.',
        requires: 'viewer',
        requiresLabel: 'Viewer access'
    },
    {
        category: 'Staff Quota',
        name: '/inactivitylist',
        description: 'List current and upcoming inactivity notices.',
        requires: 'viewer',
        requiresLabel: 'Viewer access'
    },
    {
        category: 'Staff Quota',
        name: '/inactivityremove',
        description: 'Cancel an inactivity notice by ID.',
        requires: 'viewer',
        requiresLabel: 'Viewer access'
    },
    {
        category: 'Payments & Reports',
        name: '/staffpayouts',
        description: 'View unpaid Robux balances for all staff.',
        requires: 'paymentsManager',
        requiresLabel: 'Payments manager'
    },
    {
        category: 'Payments & Reports',
        name: '/staffpaymentedit',
        description: 'Add to or set a staff member’s Robux balance.',
        requires: 'paymentsManager',
        requiresLabel: 'Payments manager'
    },
    {
        category: 'Payments & Reports',
        name: '/staffweeklyreport',
        description: 'Export this week’s quota, warnings, and payouts.',
        requires: 'paymentsManager',
        requiresLabel: 'Payments manager'
    },
    {
        category: 'Payments & Reports',
        name: '/wipestaffpayments',
        description: 'Archive and clear all unpaid Robux balances.',
        requires: 'paymentsManager',
        requiresLabel: 'Payments manager'
    },
    {
        category: 'Payments & Reports',
        name: '/wipeguidequotas',
        description: 'Archive and clear the Guide weekly quota totals.',
        requires: 'quotaAndPayments',
        requiresLabel: 'Quota manager + payments manager'
    },
    {
        category: 'Payments & Reports',
        name: '/wipesarquota',
        description: 'Archive and clear the S&R weekly quota totals.',
        requires: 'quotaAndPayments',
        requiresLabel: 'Quota manager + payments manager'
    },
    {
        category: 'Payments & Reports',
        name: '/wipesarquotas',
        description: 'Archive and clear the S&R weekly quota totals.',
        requires: 'quotaAndPayments',
        requiresLabel: 'Quota manager + payments manager'
    },
    {
        category: 'General',
        name: '/leaderboard',
        description: 'View the summit stamp leaderboard.',
        requires: 'everyone',
        requiresLabel: 'Everyone'
    },
    {
        category: 'General',
        name: '/profile',
        description: 'View your climber profile or another climber’s profile.',
        requires: 'everyone',
        requiresLabel: 'Everyone'
    },
    {
        category: 'General',
        name: '/help',
        description: 'View a list of commands you can currently use.',
        requires: 'everyone',
        requiresLabel: 'Everyone'
    }
];

function hasAnyRequiredRole(member, roleIds) {
    if (!member || !member.guild) {
        return false;
    }

    if (member.guild.ownerId === member.id) {
        return true;
    }

    if (!member.roles || !member.roles.highest) {
        return false;
    }

    const ids = roleIds.filter(Boolean);
    if (ids.length === 0) {
        return false;
    }

    for (const roleId of ids) {
        const requiredRole = member.guild.roles?.cache.get(roleId);
        if (!requiredRole) {
            continue;
        }
        if (member.roles.highest.position >= requiredRole.position) {
            return true;
        }
    }

    return false;
}

function hasAccess(member, requirement) {
    if (requirement === 'everyone') {
        return true;
    }

    if (requirement === 'guide') {
        return hasAnyRequiredRole(member, [getRoleId('guide')]);
    }

    if (requirement === 'staff') {
        return hasAnyRequiredRole(member, [getRoleId('staff')]);
    }

    if (requirement === 'quotaManager') {
        return hasAnyRequiredRole(member, [staffConfig.roles.quotaManager]);
    }

    if (requirement === 'paymentsManager') {
        return hasAnyRequiredRole(member, [staffConfig.roles.paymentsManager]);
    }

    if (requirement === 'viewer') {
        return hasAnyRequiredRole(member, viewerRoleIds);
    }

    if (requirement === 'quotaAndPayments') {
        return (
            hasAnyRequiredRole(member, [staffConfig.roles.quotaManager]) &&
            hasAnyRequiredRole(member, [staffConfig.roles.paymentsManager])
        );
    }

    return false;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('View commands that you have permission to use.'),

    async execute(interaction) {
        let member = interaction.member;

        if (interaction.guild && (!member || !member.roles || !member.roles.highest)) {
            try {
                member = await interaction.guild.members.fetch(interaction.user.id);
            } catch (err) {
                console.error('Failed to fetch guild member for help command:', err);
                member = interaction.member;
            }
        }

        const availableCommands = commandCatalog.filter(command => hasAccess(member, command.requires));

        const categories = new Map();
        for (const command of availableCommands) {
            if (!categories.has(command.category)) {
                categories.set(command.category, []);
            }
            categories.get(command.category).push(command);
        }

        const commandFields = [...categories.entries()].map(([category, commands]) => ({
            name: category,
            value: commands.map(command =>
                `- **${command.name}** • ${command.requiresLabel}`
            ).join('\n')
        }));

        const embed = new EmbedBuilder()
            .setTitle('World Expeditions Manager Help')
            .setDescription('Here are the commands you currently have permission to use:')
            .addFields(
                commandFields.length > 0
                    ? commandFields
                    : {
                        name: 'Available Commands',
                        value: 'You currently do not have access to any commands.'
                    }
            )
            .setColor(0x2B2D31)
            .setTimestamp();

        await interaction.reply({ embeds: [embed], ephemeral: true });
    }
};