const {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');

const fs = require('fs');
const path = require('path');

const { getRoleId } = require('../utils/config');

const REQUIRED_ROLE_ID = getRoleId('guide');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('transferrobloxuser')
        .setDescription('Transfer a Roblox user to a new Discord user.')
        .addStringOption(option =>
            option
                .setName('username')
                .setDescription('Roblox username')
                .setRequired(true)
        )
        .addUserOption(option =>
            option
                .setName('discorduser')
                .setDescription('New Discord user')
                .setRequired(true)
        ),

    async execute(interaction) {
        // Permission check
        const commandUser = interaction.member;
        const requiredRole = interaction.guild.roles.cache.get(REQUIRED_ROLE_ID);
        if (!requiredRole) {
            console.error('Required role not found.');
            return interaction.reply({ content: 'There is a configuration error with this command.', ephemeral: true });
        }

        const hasPermission = commandUser.roles.cache.has(REQUIRED_ROLE_ID)
            || (commandUser.roles.highest && commandUser.roles.highest.position >= requiredRole.position);

        if (!hasPermission) {
            const permissionEmbed = new EmbedBuilder()
                .setTitle('World Expeditions')
                .setDescription('You do not have permission to run that command.')
                .setColor(0xFF0000);
            return interaction.reply({ embeds: [permissionEmbed], ephemeral: true });
        }

        // Get options
        const usernameRaw = interaction.options.getString('username');
        const newdiscorduser = interaction.options.getUser('discorduser');

        if (!usernameRaw) {
            return interaction.reply({ content: 'Username is required.', ephemeral: true });
        }
        if (!newdiscorduser) {
            return interaction.reply({ content: 'New Discord user not found.', ephemeral: true });
        }

        const username = usernameRaw.trim();
        const robloxDbPath = path.join(__dirname, '..', 'data', 'robloxusers.json');
        const climbersDbPath = path.join(__dirname, '..', 'data', 'climbers.json');

        // Load both databases before changing either one.
        let users = [];
        let climbers = {};
        try {
            if (fs.existsSync(robloxDbPath)) {
                const raw = fs.readFileSync(robloxDbPath, 'utf8');
                users = JSON.parse(raw || '[]');
                if (!Array.isArray(users)) {
                    throw new Error('robloxusers.json must contain an array');
                }
            }
            climbers = JSON.parse(fs.readFileSync(climbersDbPath, 'utf8') || '{}');
            if (!climbers || Array.isArray(climbers) || typeof climbers !== 'object') {
                throw new Error('climbers.json must contain an object');
            }
        } catch (err) {
            console.error('Failed to read or parse climber databases', err);
            return interaction.reply({ content: 'Failed to read the climber databases.', ephemeral: true });
        }

        // Find user
        const userIndex = users.findIndex(u => (u.username || '').toLowerCase() === username.toLowerCase());

        if (userIndex === -1) {
            const embed = new EmbedBuilder()
                .setTitle('World Expeditions Guide Department')
                .setDescription(
                    `❌ Roblox user **${username}** was not found in the climber database.\n\n` +
                    `Use **/robloxstamplist** to view all registered Roblox climbers.\n\n` +
                    `If the climber is not listed, add summit stamps to their discord profile using **/stampupdate**.`
                )
                .setColor(0xFF0000);
            return interaction.reply({ embeds: [embed], ephemeral: false });
        }

        const robloxUser = users[userIndex];
        const existingSummits = Number(climbers[newdiscorduser.id]?.summits) || 0;
        const transferredSummits = Number(robloxUser.summits) || 0;

        const confirmationEmbed = new EmbedBuilder()
            .setTitle('World Expeditions Guide Department')
            .setDescription(
                `Are you sure you want to transfer **${username}** to <@${newdiscorduser.id}>?\n\n` +
                `Transferring summit stamps: **${transferredSummits} 🏔️**`
            )
            .setColor(0x00FF00);
        await interaction.reply({ embeds: [confirmationEmbed], ephemeral: false });
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('confirm_transfer')
                    .setLabel('Confirm Transfer')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId('cancel_transfer')
                    .setLabel('Cancel Transfer')
                    .setStyle(ButtonStyle.Danger)
            );
        await interaction.followUp({ content: 'Please confirm everything is correct before proceeding.', components: [row], ephemeral: true });
        
        const collector = interaction.channel.createMessageComponentCollector({ time: 60000 });

        collector.on('collect', async i => {
            if (i.user.id !== interaction.user.id) {
                return i.reply({ content: 'You cannot confirm this transfer.', ephemeral: true });
            }
            if (i.customId === 'confirm_transfer') {
                collector.stop('confirmed');
            } else if (i.customId === 'cancel_transfer') {
                collector.stop('cancelled');
            }
            await i.update({ components: [] });
        });
      
        const cancelEmbed = new EmbedBuilder()
            .setTitle('World Expeditions Guide Department')
            .setDescription('Transfer cancelled.')
            .setColor(0xFF0000);
      
        collector.on('end', async (collected, reason) => {
            if (reason === 'confirmed') {
                // Proceed with transfer
                climbers[newdiscorduser.id] = {
                    ...(climbers[newdiscorduser.id] || {}),
                    summits: existingSummits + transferredSummits
                };
                users.splice(userIndex, 1);

                // Save both databases and restore the first file if the second write fails.
                try {
                    const originalClimbers = fs.readFileSync(climbersDbPath, 'utf8');
                    fs.writeFileSync(climbersDbPath, JSON.stringify(climbers, null, 2), 'utf8');
                    try {
                        fs.writeFileSync(robloxDbPath, JSON.stringify(users, null, 2), 'utf8');
                    } catch (err) {
                        fs.writeFileSync(climbersDbPath, originalClimbers, 'utf8');
                        throw err;
                    }
                } catch (err) {
                    console.error('Failed to write climber databases', err);
                    return interaction.reply({ content: 'Failed to save the updated climber databases.', ephemeral: true });
                }

                console.log(`Transferred ${username} to ${newdiscorduser.tag} (${newdiscorduser.id}) with ${transferredSummits} summit stamps.`);

                const successEmbed = new EmbedBuilder()
                    .setTitle('World Expeditions Guide Department')
                    .setDescription(
                        `✅ Successfully transferred **${username}** to <@${newdiscorduser.id}>.\n\n` +
                        `Transferred summit stamps: **${transferredSummits} 🏔️**`
                    )
                    .setColor(0x00FF00);

                return interaction.reply({ embeds: [successEmbed] });
            }

            if (reason === 'cancelled') {
                return interaction.followUp({ embeds: [cancelEmbed], ephemeral: true });
            }
        });
    }
};
